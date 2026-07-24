const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { expireUserBatteryIfNeeded } = require('../lib/batteryExpiry');

// POST /api/auth/profile — called after Supabase signup to create public profile
router.post('/profile', requireAuth, async (req, res) => {
  const { username, bio, avatar_url, initial_battery, interests } = req.body;
  const userId = req.user.id;

  if (!username || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  // Check username uniqueness
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', username.trim().toLowerCase())
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const batteryLevel = typeof initial_battery === 'number'
    ? Math.max(0, Math.min(100, initial_battery))
    : 50;

  const { data, error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      username: username.trim().toLowerCase(),
      // display_name ya no es un campo editable: el usuario solo tiene
      // nombre de usuario. Se guarda igual al username para no romper la
      // restricción NOT NULL de la columna ni el resto de queries que
      // todavía la seleccionan (siempre coincide con el username).
      display_name: username.trim().slice(0, 16),
      bio: bio ? bio.trim().slice(0, 160) : null,
      avatar_url: avatar_url || null,
      battery_level: batteryLevel,
      battery_updated_at: new Date().toISOString(),
      onboarding_done: true,
      interests: Array.isArray(interests) ? interests : [],
      // Si el cliente indica que en este flujo se aceptaron los ToS
      // (registro por email con checkbox previo, ver AuthPage.jsx), lo
      // marcamos aquí para que el TermsGate no se dispare tras el
      // onboarding. Para OAuth (Google/Apple) no llega este flag y el
      // gate se muestra al terminar el onboarding.
      ...(req.body.terms_accepted === true ? { terms_accepted_at: new Date().toISOString() } : {}),
    })
    .select()
    .single();

  if (error) {
    console.error('Profile creation error:', error);
    return res.status(500).json({ error: 'Failed to create profile' });
  }

  // Record initial battery in history
  // (ver nota en routes/users.js POST /push-subscribe: .catch() encadenado
  // directamente sobre el builder de supabase-js no es seguro, por eso
  // try/catch explicito en vez de .catch(() => {}))
  try {
    await supabase.from('battery_history').insert({
      user_id: userId,
      level: batteryLevel,
      day_of_week: new Date().getDay(),
      hour: new Date().getHours(),
    });
  } catch (err) {
    console.error('[auth] battery_history insert error:', err);
  }

  res.status(201).json({ user: data });
});

// GET /api/auth/me — get current user profile
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*, user_badges(badge_id, earned_at, badges(*))')
    .eq('id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Profile not found. Please complete setup.' });
  }

  const user = await expireUserBatteryIfNeeded(data);
  res.json({ user });
});

// POST /api/auth/accept-terms — marca los Términos+Privacidad+edad mínima
// como aceptados por el usuario autenticado.
//
// Se llama:
//   - Justo después de un signUp por email exitoso (el cliente ya validó
//     el checkbox antes de crear la cuenta, esto solo persiste el gesto).
//   - Cuando el usuario acepta la pantalla obligatoria "Antes de
//     continuar" que se le muestra al primer login por OAuth (Google /
//     Apple) o a cualquier usuario cuya fila tenga terms_accepted_at
//     null. Ver client/src/components/TermsGate.jsx y
//     supabase_schema_phase130_terms_accepted_at.sql.
//
// Idempotente: si ya está aceptado, no reescribe la fecha (evita perder
// la fecha original de aceptación por un click accidental posterior).
router.post('/accept-terms', requireAuth, async (req, res) => {
  try {
    const { data: existing, error: readErr } = await supabase
      .from('users')
      .select('terms_accepted_at')
      .eq('id', req.user.id)
      .single();
    if (readErr) throw readErr;

    if (existing?.terms_accepted_at) {
      return res.json({ accepted_at: existing.terms_accepted_at });
    }

    const acceptedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('users')
      .update({ terms_accepted_at: acceptedAt })
      .eq('id', req.user.id);
    if (updateErr) throw updateErr;

    res.json({ accepted_at: acceptedAt });
  } catch (err) {
    console.error('[auth] POST /accept-terms error:', err);
    res.status(500).json({ error: 'No se pudo registrar la aceptación' });
  }
});

module.exports = router;
