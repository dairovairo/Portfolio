const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { createImageUpload, storeImage } = require('../lib/imageUpload');
const { applyBatteryExpiry, applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');

const upload = createImageUpload({ maxSizeMb: 2 });
const uploadMascotPreview = createImageUpload({ maxSizeMb: 2 });

function uploadAvatar(req, res, next) {
  upload.single('avatar')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la imagen' });
  });
}

function uploadMascotPreviewFile(req, res, next) {
  uploadMascotPreview.single('mascot')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la mascota' });
  });
}

// POST /api/users/avatar — upload avatar to Supabase Storage
router.post('/avatar', requireAuth, uploadAvatar, async (req, res) => {
  try {
    const url = await storeImage({
      file: req.file,
      objectName: `avatars/${req.user.id}`,
      fallbackMaxLength: 3000000,
    });

    const { error } = await supabase
      .from('users')
      .update({ avatar_url: url })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ url });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo subir la imagen' });
  }
});

// POST /api/users/mascot-preview — sube el "retrato" de la mascota equipada
// (ropa/calzado/gorro/accesorios/actividad, ya recoloreados y horneados en
// un unico PNG por el cliente — ver lib/mascotRenderer.js ->
// renderMascotOverlayBlob) para que aparezca en la tarjeta de amigo de los
// demas (ver FriendCard.jsx). Si no se adjunta archivo (mascota base, sin
// nada equipado) se interpreta como "sin personalizacion" y se limpia la
// URL guardada.
router.post('/mascot-preview', requireAuth, uploadMascotPreviewFile, async (req, res) => {
  try {
    let url = null;
    if (req.file) {
      // Los bakes nuevos "con padding" llegan con nombre mascot-v2.png (ver
      // client MascotPreviewSync.jsx) y se guardan en un objeto ...-v2, de
      // forma que la URL pública contiene "-v2" y el cliente
      // (MascotPreviewOverlay.jsx) sabe que debe "des-acolchar" al
      // mostrarla. Los clientes con JS antiguo cacheado siguen subiendo
      // mascot.png sin padding al path antiguo — cada formato en su path.
      const isV2 = /v2/i.test(req.file.originalname || '');
      url = await storeImage({
        file: req.file,
        objectName: `mascot-previews/${req.user.id}${isV2 ? '-v2' : ''}`,
        fallbackMaxLength: 3000000,
      });
    }

    const { error } = await supabase
      .from('users')
      .update({ mascot_preview_url: url })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ url });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo guardar la mascota' });
  }
});

// POST /api/users/push-subscribe — store push subscription
router.post('/push-subscribe', requireAuth, async (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Missing subscription fields' });
  }

  // NOTA: el query builder de supabase-js es "thenable" pero no una Promise
  // real -- .catch() encadenado directamente sobre el builder (sin pasar
  // antes por .then()) lanza "TypeError: ...catch is not a function" de
  // forma SINCRONA. Al ocurrir dentro de un handler async, esto rechaza la
  // promesa del handler sin que Express la capture -> unhandled rejection
  // -> crash del proceso completo. Por eso se usa try/catch explicito.
  try {
    // onConflict va sobre 'endpoint' (no 'user_id,endpoint'): el endpoint
    // identifica un navegador/dispositivo concreto, no un usuario. Si antes
    // se resolvia por el par (user_id, endpoint), una segunda cuenta que
    // iniciara sesion en el mismo dispositivo creaba una fila NUEVA en vez
    // de tomar el control de esa suscripcion, y el dispositivo terminaba
    // recibiendo los avisos de ambas cuentas (p. ej. recordatorios de
    // quedadas/eventos a los que el usuario actual no esta inscrito).
    // Con 'endpoint' como conflicto, volver a suscribirse siempre reasigna
    // ese endpoint al usuario que ha iniciado sesion ahora.
    await supabase.from('push_subscriptions').upsert({
      user_id: req.user.id,
      endpoint,
      p256dh,
      auth,
    }, { onConflict: 'endpoint' });
  } catch (err) {
    console.error('[users] push-subscribe upsert error:', err);
  }

  res.json({ success: true });
});

// PATCH /api/users/me/seen — heartbeat for online status
router.patch('/me/seen', requireAuth, async (req, res) => {
  await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);
  res.json({ success: true });
});

// PATCH /api/users/me/go-offline — immediately mark user as offline (privacy: showOnline=false)
router.patch('/me/go-offline', requireAuth, async (req, res) => {
  // Set last_seen_at far in the past so presence checks return false immediately
  const farPast = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
  await supabase
    .from('users')
    .update({ last_seen_at: farPast })
    .eq('id', req.user.id);
  res.json({ success: true });
});

// GET /api/users/search?q=username
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, username, avatar_url, bio, battery_level, battery_is_estimated, battery_updated_at, last_seen_at')
    .ilike('username', `%${q}%`)
    .neq('id', req.user.id)
    .limit(10);

  if (error) return res.status(500).json({ error: 'Search failed' });
  res.json({ users: applyBatteryExpiryToUsers(data) });
});

// GET /api/users/:id/stats — public stats for any user profile
router.get('/:id/stats', requireAuth, async (req, res) => {
  const targetId = req.params.id;

  try {
    // Check show_public_stats privacy setting (skip check when viewing own profile)
    if (req.user.id !== targetId) {
      const { data: privacyRow } = await supabase
        .from('users')
        .select('show_public_stats')
        .eq('id', targetId)
        .single();
      if (privacyRow && privacyRow.show_public_stats === false) {
        return res.json({ stats: null });
      }
    }

    const [friendsRes, createdRes, participationsRes, batteryRes, userRes] = await Promise.all([
      // Accepted friendships (both directions)
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`)
        .eq('status', 'accepted'),

      // Pools created by this user
      supabase
        .from('hangout_pools')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', targetId),

      // All pool_participants rows for this user (creator is auto-joined too)
      supabase
        .from('pool_participants')
        .select('pool_id', { count: 'exact', head: true })
        .eq('user_id', targetId),

      // Battery update count (service role bypasses RLS)
      supabase
        .from('battery_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetId),

      // member_since
      supabase
        .from('users')
        .select('created_at')
        .eq('id', targetId)
        .single(),
    ]);

    const poolsCreated       = createdRes.count ?? 0;
    const totalParticipations = participationsRes.count ?? 0;
    // Creator is auto-joined so subtract to get "joined others' pools"
    const poolsJoined        = Math.max(0, totalParticipations - poolsCreated);

    res.json({
      stats: {
        friends_count:   friendsRes.count ?? 0,
        pools_created:   poolsCreated,
        pools_joined:    poolsJoined,
        battery_updates: batteryRes.count ?? 0,
        member_since:    userRes.data?.created_at ?? null,
      },
    });
  } catch (e) {
    console.error('[USERS] GET /:id/stats', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, username, bio, avatar_url, mascot_preview_url, mascot_name, interests, show_interests, show_public_stats, show_badges,
      battery_level, battery_is_estimated, battery_updated_at, last_seen_at, created_at,
      user_badges(badge_id, earned_at, badges(name, emoji, description, category))
    `)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });

  // Strip interests if the user has hidden them (only for other users, not for yourself)
  if (req.user.id !== req.params.id && data.show_interests === false) {
    data.interests = [];
  }

  // Strip badges if the user has hidden them (only for other users, not for yourself)
  if (req.user.id !== req.params.id && data.show_badges === false) {
    data.user_badges = [];
  }

  res.json({ user: applyBatteryExpiry(data) });
});

// PATCH /api/users/me — update profile
router.patch('/me', requireAuth, async (req, res) => {
  const { avatar_url, bio, interests, show_interests, show_public_stats, show_badges, discoverable, mascot_name, mute_new_pools, mute_pool_chats, mute_community_chats, mute_community_threads, mute_group_chats, mute_new_events, mute_event_recommendations, mute_new_raffles, mute_pool_sniffer } = req.body;
  const updates = {};
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 160) : null;
  if (interests !== undefined) {
    const cleanInterests = Array.isArray(interests) ? interests.filter(Boolean) : [];
    // Mismo mínimo que el onboarding (OnboardingPage.jsx): evita que se
    // pueda editar el perfil después para dejar los intereses por debajo
    // de 3, que es lo que exigimos al crear la cuenta.
    if (cleanInterests.length < 3) {
      return res.status(400).json({ error: 'Elige al menos 3 intereses' });
    }
    updates.interests = cleanInterests;
  }
  if (mascot_name !== undefined) updates.mascot_name = (mascot_name && mascot_name.trim()) ? mascot_name.trim().slice(0, 20) : 'Volty';
  if (show_interests !== undefined) updates.show_interests = Boolean(show_interests);
  if (show_public_stats !== undefined) updates.show_public_stats = Boolean(show_public_stats);
  if (show_badges !== undefined) updates.show_badges = Boolean(show_badges);
  if (discoverable !== undefined) updates.discoverable = Boolean(discoverable);
  if (mute_new_pools !== undefined) updates.mute_new_pools = Boolean(mute_new_pools);
  if (mute_pool_chats !== undefined) updates.mute_pool_chats = Boolean(mute_pool_chats);
  if (mute_community_chats !== undefined) updates.mute_community_chats = Boolean(mute_community_chats);
  if (mute_community_threads !== undefined) updates.mute_community_threads = Boolean(mute_community_threads);
  if (mute_group_chats !== undefined) updates.mute_group_chats = Boolean(mute_group_chats);
  if (mute_new_events !== undefined) updates.mute_new_events = Boolean(mute_new_events);
  if (mute_event_recommendations !== undefined) updates.mute_event_recommendations = Boolean(mute_event_recommendations);
  if (mute_new_raffles !== undefined) updates.mute_new_raffles = Boolean(mute_new_raffles);
  if (mute_pool_sniffer !== undefined) updates.mute_pool_sniffer = Boolean(mute_pool_sniffer);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: applyBatteryExpiry(data) });
});

// ── POST /api/users/me/report-location ────────────────────────────────
// Fase 110: recibe {lat, lng} del navegador (UserLocationContext los pide
// al arrancar la app) y actualiza users.home_lat/home_lng con la regla de
// "doble confirmación de sitio nuevo" para que el home refleje dónde vive
// el usuario, no dónde abrió la app hoy. Toda la lógica de decisión está
// en lib/homeLocation.js y cubierta por tests unitarios; aquí sólo hay
// I/O.
router.post('/me/report-location', requireAuth, async (req, res) => {
  const { resolveHomeLocationUpdate } = require('../lib/homeLocation');
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat/lng deben ser numéricos' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng fuera de rango WGS-84' });
  }
  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('home_lat, home_lng, pending_home_lat, pending_home_lng')
      .eq('id', req.user.id)
      .single();
    if (userErr) throw userErr;

    const current = user?.home_lat != null && user?.home_lng != null
      ? { lat: Number(user.home_lat), lng: Number(user.home_lng) }
      : null;
    const pending = user?.pending_home_lat != null && user?.pending_home_lng != null
      ? { lat: Number(user.pending_home_lat), lng: Number(user.pending_home_lng) }
      : null;

    const result = resolveHomeLocationUpdate({ current, pending, incoming: { lat, lng } });
    const now = new Date().toISOString();
    const updates = {};

    // El home se toca si cambia (set_home, promote_pending_to_home) o si
    // se confirma (queremos actualizar home_updated_at para saber "última
    // vez visto ahí"). En confirm/discard el lat/lng no cambian.
    if (result.change === 'set_home' || result.change === 'promote_pending_to_home') {
      updates.home_lat = result.home.lat;
      updates.home_lng = result.home.lng;
      updates.home_updated_at = now;
    } else if (result.change === 'confirm_home' || result.change === 'confirm_home_discard_pending') {
      updates.home_updated_at = now;
    }

    if (result.pending) {
      updates.pending_home_lat = result.pending.lat;
      updates.pending_home_lng = result.pending.lng;
      updates.pending_home_seen_at = now;
    } else if (
      result.change === 'promote_pending_to_home' ||
      result.change === 'confirm_home_discard_pending' ||
      result.change === 'confirm_home'
    ) {
      // Limpiar cualquier pending previo (aunque no lo había en confirm_home,
      // el UPDATE con NULL es idempotente).
      updates.pending_home_lat = null;
      updates.pending_home_lng = null;
      updates.pending_home_seen_at = null;
    }

    if (Object.keys(updates).length) {
      const { error: updateErr } = await supabase
        .from('users')
        .update(updates)
        .eq('id', req.user.id);
      if (updateErr) throw updateErr;
    }

    res.json({ change: result.change });
  } catch (err) {
    console.error('[users] POST /me/report-location error:', err);
    res.status(500).json({ error: 'Error al registrar ubicación' });
  }
});

module.exports = router;
