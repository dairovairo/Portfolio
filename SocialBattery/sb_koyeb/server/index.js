require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

// Red de seguridad: en Node 15+, una promesa rechazada sin .catch() tumba
// TODO el proceso (esto es justo lo que pasó con el bug de push-subscribe:
// un .catch() mal encadenado sobre el query builder de Supabase lanzaba un
// TypeError síncrono dentro de un handler async, que se convertía en un
// unhandledRejection y reiniciaba el contenedor entero en Railway). Con esto,
// un fallo aislado en una request queda solo registrado, sin tirar el server
// para el resto de usuarios. No sustituye a arreglar los bugs de raíz, pero
// evita que un error suelto se convierta en una caída total.
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

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

const app = express();
const PORT = process.env.PORT || 3001;

// Railway (y la mayoría de PaaS) enrutan el tráfico a través de un proxy inverso
// que añade X-Forwarded-For. Sin esto, express-rate-limit lanza un ValidationError
// en cada request y no puede identificar correctamente la IP real del cliente.
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

app.get('/api/debug/promo-pacing', async (req, res) => {
  const secret = req.headers['x-debug-secret'];
  if (secret !== (process.env.DEBUG_SECRET || 'sb-debug-2025')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    console.log('[DEBUG] Firing event promo pacing tick manually...');
    await runEventPromoPacingTick();
    res.json({ ok: true, message: 'Promo pacing tick ejecutado — revisa los logs del servidor (busca [PROMO-PACING][DEBUG])' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function decodeJwtRoleClaim(token) {
  try {
    const payloadPart = token.split('.')[1];
    const decoded = Buffer.from(payloadPart, 'base64').toString('utf8');
    return JSON.parse(decoded).role || null;
  } catch {
    return null;
  }
}

app.get('/api/debug/push-subs-count', async (req, res) => {
  const secret = req.headers['x-debug-secret'];
  if (secret !== (process.env.DEBUG_SECRET || 'sb-debug-2025')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const supabase = require('./lib/supabase');
    const { count, error } = await supabase
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true });

    const { count: promoLogCount, error: promoLogError } = await supabase
      .from('event_promo_notifications')
      .select('*', { count: 'exact', head: true });

    res.json({
      ok: !error && !promoLogError,
      push_subscriptions_count: count,
      push_subscriptions_error: error?.message || null,
      event_promo_notifications_count: promoLogCount,
      event_promo_notifications_error: promoLogError?.message || null,
      // No exponemos el valor de la clave, solo su claim "role" decodificado del JWT,
      // para descartar que en Railway se haya puesto la clave "anon" en vez de "service_role"
      // (eso haría que las tablas con RLS devuelvan 0 filas sin lanzar ningún error).
      supabase_service_key_present: Boolean(process.env.SUPABASE_SERVICE_KEY),
      supabase_service_key_role: process.env.SUPABASE_SERVICE_KEY
        ? decodeJwtRoleClaim(process.env.SUPABASE_SERVICE_KEY)
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔋 SocialBattery server running on port ${PORT} (Phase 11)`);
});
