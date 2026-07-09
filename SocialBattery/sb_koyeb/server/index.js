require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const authRoutes      = require('./routes/auth');
const usersRoutes     = require('./routes/users');
const batteryRoutes   = require('./routes/battery');
const friendsRoutes   = require('./routes/friends');
const messagesRoutes  = require('./routes/messages');
const badgesRoutes    = require('./routes/badges');
const poolsRoutes     = require('./routes/pools');
const groupsRoutes    = require('./routes/groups');
const communityRoutes = require('./routes/community');
const { expireStaleBatteries } = require('./lib/batteryExpiry');
const { notifyPoolsStartingSoon, notifyEventsStartingSoon } = require('./jobs/reminders');
const { runEventPromoPacingTick } = require('./jobs/eventPromoPacing');
const { getNotificationDayKey } = require('./lib/notificationDay');
const supabase = require('./lib/supabase');

const app = express();
const PORT = process.env.PORT || 3001;

// Railway (y cualquier proxy delante de la app) añade X-Forwarded-For a cada
// request. Sin esto, express-rate-limit lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// en cada petición (ValidationError no capturada dentro de un async handler),
// lo que provoca un unhandled rejection y tumba el proceso -> Railway lo
// reinicia en bucle -> 502 en TODO /api, que el navegador reporta como fallo
// de CORS porque la respuesta nunca llega a tener headers.
// '1' = confiar en un solo proxy delante (el de Railway).
app.set('trust proxy', 1);

// ── Security & Middleware ──────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/users/avatar', uploadLimiter);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150 });
app.use('/api', limiter);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/users',     usersRoutes);
app.use('/api/battery',   batteryRoutes);
app.use('/api/friends',   friendsRoutes);
app.use('/api/messages',  messagesRoutes);
app.use('/api/badges',    badgesRoutes);
app.use('/api/pools',     poolsRoutes);
app.use('/api/groups',    groupsRoutes);
app.use('/api/community', communityRoutes);

// ── Debug endpoints (solo en dev o con header secreto) ────────────────────────
app.get('/api/debug/reminders', async (req, res) => {
  const secret = req.headers['x-debug-secret'];
  if (secret !== (process.env.DEBUG_SECRET || 'sb-debug-2025')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    console.log('[DEBUG] Firing reminder jobs manually...');
    await Promise.all([
      notifyPoolsStartingSoon(),
      notifyEventsStartingSoon(),
    ]);
    res.json({ ok: true, message: 'Reminder jobs executed — check server logs' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnóstico del tope diario de notificaciones de eventos (fase 71).
// GET /api/debug/notifications?trigger=1
//   - Sin ?trigger=1: solo inspecciona el estado actual (no envía nada).
//   - Con ?trigger=1: además dispara un tick del pacing job ahora mismo.
// Requiere el mismo header x-debug-secret que /api/debug/reminders.
app.get('/api/debug/notifications', async (req, res) => {
  const secret = req.headers['x-debug-secret'];
  if (secret !== (process.env.DEBUG_SECRET || 'sb-debug-2025')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dayKey = getNotificationDayKey();
  const report = { ok: true, day_key: dayKey, checks: {} };

  // 1) ¿Existe y es alcanzable user_daily_notification_claims? (fuente de
  //    verdad del tope de 1 notificación/usuario/día — fase 70)
  try {
    const { data, error, count } = await supabase
      .from('user_daily_notification_claims')
      .select('user_id, event_id, claimed_at', { count: 'exact' })
      .eq('claim_date', dayKey)
      .order('claimed_at', { ascending: false })
      .limit(20);
    report.checks.user_daily_notification_claims = error
      ? { reachable: false, error: error.message, hint: 'Ejecuta supabase_schema_phase70_atomic_daily_notification_cap.sql en el SQL editor de Supabase, y confirma que SUPABASE_SERVICE_KEY en Railway es la service_role key (no la anon key).' }
      : { reachable: true, claimed_today_count: count, sample: data };
  } catch (err) {
    report.checks.user_daily_notification_claims = { reachable: false, error: err.message };
  }

  // 2) ¿Existe y es alcanzable event_promo_notifications? (histórico +
  //    base de notification_sent_count — fase 69)
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error, count } = await supabase
      .from('event_promo_notifications')
      .select('event_id, user_id, sent_at', { count: 'exact' })
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(20);
    report.checks.event_promo_notifications = error
      ? { reachable: false, error: error.message, hint: 'Ejecuta supabase_schema_phase69_event_notification_pacing.sql en el SQL editor de Supabase.' }
      : { reachable: true, sent_last_24h_count: count, sample: data };
  } catch (err) {
    report.checks.event_promo_notifications = { reachable: false, error: err.message };
  }

  // 3) Eventos premium/ultra activos y su progreso contratado vs enviado
  //    (notification_sent_count NUNCA debe incluir avisos de comunidad).
  try {
    const { data: events, error } = await supabase
      .from('community_events')
      .select('id, title, community_id, promotion_plan, notification_count, notification_sent_count, event_date')
      .in('promotion_plan', ['premium', 'ultra'])
      .gt('event_date', new Date().toISOString());
    report.checks.pending_promo_events = error
      ? { reachable: false, error: error.message }
      : { reachable: true, events: events || [] };
  } catch (err) {
    report.checks.pending_promo_events = { reachable: false, error: err.message };
  }

  // 4) RPC atómica usada para incrementar notification_sent_count.
  try {
    const { error } = await supabase.rpc('increment_event_notification_sent_count', {
      p_event_id: '00000000-0000-0000-0000-000000000000',
      p_delta: 0,
    });
    // Con un event_id inexistente, la función corre pero no actualiza nada
    // (0 filas) — si existe y es llamable, error debería ser null.
    report.checks.increment_rpc = error
      ? { reachable: false, error: error.message, hint: 'Ejecuta supabase_schema_phase70_atomic_daily_notification_cap.sql para crear la función increment_event_notification_sent_count.' }
      : { reachable: true };
  } catch (err) {
    report.checks.increment_rpc = { reachable: false, error: err.message };
  }

  if (req.query.trigger === '1') {
    console.log('[DEBUG] Disparando tick de pacing manualmente...');
    try {
      await runEventPromoPacingTick();
      report.triggered = true;
    } catch (err) {
      report.triggered = false;
      report.trigger_error = err.message;
    }
  }

  res.json(report);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.11.0', phase: 11, timestamp: new Date().toISOString() });
});

// ── Cron Jobs ──────────────────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Expiring stale batteries...');
  expireStaleBatteries().catch(err => {
    console.error('[CRON] Battery expiry failed:', err);
  });
});

cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Closing expired pools...');
  const supabase = require('./lib/supabase');
  try {
    await supabase
      .from('hangout_pools')
      .update({ status: 'closed' })
      .in('status', ['open', 'full'])
      .lt('scheduled_at', new Date().toISOString());
  } catch (err) {
    console.error('[CRON] Pool close failed:', err);
  }
});

// Recordatorio quedadas: cada minuto, notifica si faltan ~10 min para empezar
cron.schedule('* * * * *', () => {
  notifyPoolsStartingSoon().catch(err => {
    console.error('[CRON] Pool reminders failed:', err);
  });
});

// Recordatorio eventos: cada minuto, con antelacion personalizada por asistente
cron.schedule('* * * * *', () => {
  notifyEventsStartingSoon().catch(err => {
    console.error('[CRON] Event reminders failed:', err);
  });
});

// Reparto gradual de notificaciones premium/ultra: cada 5 min, hasta el
// inicio de cada evento. Prioriza llegar a las 200 mínimas (umbral de
// cobro) y luego reparte el resto de forma uniforme entre eventos activos,
// con tope de 1 notificación/usuario/día (across events). Ver
// server/jobs/eventPromoPacing.js.
cron.schedule('*/5 * * * *', () => {
  runEventPromoPacingTick().catch(err => {
    console.error('[CRON] Event promo pacing failed:', err);
  });
});

// ── Red de seguridad a nivel de proceso ────────────────────────────────────
// Ya hemos visto dos veces que un error no capturado en un solo request
// (rate-limit sin trust proxy, .catch() sobre un builder de supabase-js que
// no es una Promise real) tumba el proceso ENTERO y deja la app en bucle de
// reinicios (502 en todo /api). Esto es una ultima red de seguridad: si algo
// similar se cuela en el futuro, se loguea en vez de matar el contenedor.
// No sustituye a arreglar la causa real cuando aparezca en los logs.
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔋 SocialBattery server running on port ${PORT} (Phase 11)`);
});
