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
const discoverRoutes  = require('./routes/discover');
const { expireStaleBatteries } = require('./lib/batteryExpiry');
const { notifyPoolsStartingSoon, notifyEventsStartingSoon } = require('./jobs/reminders');
const { runEventPromoPacingTick } = require('./jobs/eventPromoPacing');
const { getNotificationDayKey } = require('./lib/notificationDay');
const { INSTANCE_ID } = require('./lib/instanceId');
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
// CLIENT_URL admite una lista separada por comas (p.ej.
// "https://socialbattery.pro,https://www.socialbattery.pro,https://portfolio-nmc3.onrender.com")
// para poder servir el frontend desde el dominio propio Y desde los dominios
// de plataforma (onrender/vercel/etc) a la vez sin que el navegador bloquee
// las peticiones por CORS. Antes `origin` era un único string, así que en
// cuanto el dominio del frontend cambiaba (p.ej. al mover el proyecto a
// socialbattery.pro) el origin permitido se quedaba apuntando al dominio
// viejo y el login empezaba a fallar con "Access-Control-Allow-Origin ...
// that is not equal to the supplied origin" — hay que actualizar la env var
// CLIENT_URL en el hosting (Railway/Koyeb) para que incluya el dominio
// actual del frontend.
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Peticiones sin header Origin (curl, health checks, server-to-server)
    // no llevan CORS, así que se dejan pasar.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin no permitido por CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/users/avatar', uploadLimiter);

// Rate limit general de la API.
//
// Antes: max=150 / 15min por IP → 10 req/min. Con `keyGenerator` por
// defecto de express-rate-limit, el "cubo" se comparte entre TODAS las
// personas que salen a Internet por la misma IP pública. En una red
// doméstica (dos hermanos usando la app en el mismo WiFi) los contadores
// de ambos se suman y los 429 llegan MUY rápido — cerrándonos a los dos
// de golpe. Para una SPA con polling de mensajes, batería y notifs eso
// se agotaba en minutos.
//
// Cambios:
//   1. `keyGenerator` extrae el user id del JWT (payload.sub), con
//      fallback a la IP para peticiones sin auth (login, signup, etc).
//      Así cada usuario tiene SU propio cubo y no se pisan aunque
//      compartan router.
//   2. `max` sube de 150 → 600 requests / 15min. Con SPA + polling da
//      margen sobrado (40 req/min por usuario) sin dejar la puerta
//      abierta a bots. Ajustable si volvemos a ver 429 en producción.
//   3. Devolvemos `Retry-After` en cabecera estándar (comportamiento
//      por defecto de express-rate-limit, lo hacemos explícito con
//      `standardHeaders: true`) para que el cliente pueda esperar el
//      tiempo justo antes de reintentar (ver src/lib/api.js).
//
// La extracción del `sub` del JWT es sin verificar la firma — sólo la
// usamos como key del cubo, no como identidad autenticada. Verificar
// firma aquí sería innecesario (encarecería cada request) y además ya
// la valida el resto del stack cuando toca datos reales.
function jwtSubjectFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return payload?.sub || null;
  } catch (_e) {
    return null;
  }
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sub = jwtSubjectFromRequest(req);
    // Prefijo 'u:' vs 'ip:' para que un usuario auth no comparta cubo
    // con las peticiones anónimas que puedan salir de su misma IP.
    return sub ? `u:${sub}` : `ip:${req.ip}`;
  },
});
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
app.use('/api/discover',  discoverRoutes);

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

// Prueba directa del mecanismo de tope diario (fase 72).
// GET /api/debug/notifications/captest
//
// Los 4 checks de /api/debug/notifications de arriba solo comprueban que las
// tablas se puedan LEER con la key actual — eso NO prueba que la restricción
// UNIQUE (user_id, claim_date) exista de verdad. Si esa tabla se creó en un
// intento anterior con otra forma, "CREATE TABLE IF NOT EXISTS" de las fases
// 70/71 no la corrige (no toca nada si el nombre ya existe), y te quedas sin
// la protección aunque el SQL "se ejecute sin error".
//
// Este endpoint reserva el hueco del día DOS VECES seguidas para el mismo
// usuario (con una claim_date "de prueba" que no pisa datos reales) y mide
// directamente si la segunda reserva fue bloqueada, que es exactamente lo
// que server/jobs/eventPromoPacing.js necesita para no notificar dos veces
// el mismo día. Limpia sus propias filas de prueba al terminar.
app.get('/api/debug/notifications/captest', async (req, res) => {
  const secret = req.headers['x-debug-secret'];
  if (secret !== (process.env.DEBUG_SECRET || 'sb-debug-2025')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const TEST_CLAIM_DATE = '2000-01-01'; // fecha centinela, nunca coincide con "hoy"
  const report = { ok: true, test_claim_date: TEST_CLAIM_DATE };

  try {
    // 0) Usuario real para satisfacer la FK user_id -> users(id). Se puede
    //    forzar uno concreto con ?user_id=<uuid>.
    let testUserId = req.query.user_id;
    if (!testUserId) {
      const { data: anyUser, error: userErr } = await supabase.from('users').select('id').limit(1).single();
      if (userErr || !anyUser) {
        return res.status(500).json({ ok: false, error: 'No se encontró ningún usuario para la prueba', detail: userErr?.message });
      }
      testUserId = anyUser.id;
    }
    report.test_user_id = testUserId;

    // 1) Limpieza previa por si quedó basura de una ejecución anterior fallida.
    await supabase.from('user_daily_notification_claims').delete().eq('user_id', testUserId).eq('claim_date', TEST_CLAIM_DATE);

    // 2) Primer intento de reserva — debe GANAR (insertar 1 fila).
    const { data: first, error: firstErr } = await supabase
      .from('user_daily_notification_claims')
      .upsert({ user_id: testUserId, claim_date: TEST_CLAIM_DATE, event_id: null }, { onConflict: 'user_id,claim_date', ignoreDuplicates: true })
      .select('user_id');

    // 3) Segundo intento, mismo usuario y misma fecha — debe PERDER (0 filas).
    const { data: second, error: secondErr } = await supabase
      .from('user_daily_notification_claims')
      .upsert({ user_id: testUserId, claim_date: TEST_CLAIM_DATE, event_id: null }, { onConflict: 'user_id,claim_date', ignoreDuplicates: true })
      .select('user_id');

    // 4) Limpieza final — nunca dejar la fila de prueba en la tabla.
    await supabase.from('user_daily_notification_claims').delete().eq('user_id', testUserId).eq('claim_date', TEST_CLAIM_DATE);

    report.first_claim = { won: !firstErr && (first?.length || 0) === 1, rows_returned: first?.length ?? null, error: firstErr?.message || null, error_code: firstErr?.code || null };
    report.second_claim = { won: !secondErr && (second?.length || 0) === 1, rows_returned: second?.length ?? null, error: secondErr?.message || null, error_code: secondErr?.code || null };

    if (firstErr || secondErr) {
      report.ok = false;
      report.verdict = 'ERROR - no se pudo escribir en user_daily_notification_claims. Mira error_code/error de arriba: si es 42501 es RLS (SUPABASE_SERVICE_KEY en Railway no es la service_role key real), si es 42P10 falta la restriccion UNIQUE(user_id, claim_date) (la tabla existe con otra forma; haz DROP TABLE public.user_daily_notification_claims CASCADE en el SQL Editor y vuelve a correr supabase_schema_phase71_notification_cap_reapply.sql), si es 42P01 la tabla no existe en absoluto.';
    } else if (report.first_claim.won && !report.second_claim.won) {
      report.verdict = 'OK - el tope diario funciona correctamente a nivel de base de datos: la primera reserva gana, la segunda queda bloqueada. Si en la app real sigues viendo 2 notificaciones el mismo dia, la causa NO es esta tabla - revisa si hay mas de un servicio/deploy activo en Railway respondiendo al cron (Settings, verifica que solo hay 1 servicio corriendo, no una version vieja y una nueva a la vez).';
    } else if (report.first_claim.won && report.second_claim.won) {
      report.ok = false;
      report.verdict = 'BUG CONFIRMADO - ambas reservas ganaron, es decir, el mismo usuario puede reservar el hueco del mismo dia dos veces. La restriccion UNIQUE(user_id, claim_date) no esta realmente aplicada en la tabla, aunque no haya dado error. Haz DROP TABLE public.user_daily_notification_claims CASCADE en el SQL Editor de Supabase y vuelve a correr supabase_schema_phase71_notification_cap_reapply.sql desde cero.';
    } else {
      report.ok = false;
      report.verdict = 'INESPERADO - ni siquiera la primera reserva gano. Revisa first_claim.error arriba.';
    }
  } catch (err) {
    report.ok = false;
    report.fatal_error = err.message;
  }

  res.json(report);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.11.0', phase: 11, build: 'notif-cap-fase72-captest', timestamp: new Date().toISOString() });
});

// ── Cron Jobs ──────────────────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Expiring stale batteries...');
  expireStaleBatteries().catch(err => {
    console.error('[CRON] Battery expiry failed:', err);
  });
});

// Borrado de quedadas caducadas: cada 10 min.
// Regla: si la quedada tiene fecha de fin (ends_at), se borra al llegar esa
// fecha. Si no tiene fecha de fin, se borra 2 horas después de haberse
// creado (created_at + 2h) — antes se cerraban (status='closed') nada más
// empezar (scheduled_at), lo cual borraba/ocultaba la quedada demasiado
// pronto, incluso si seguía en marcha. El borrado es un DELETE real (todas
// las tablas relacionadas — mensajes, participantes, invitaciones, polls —
// tienen ON DELETE CASCADE sobre hangout_pools).
cron.schedule('*/10 * * * *', async () => {
  console.log('[CRON] Deleting expired pools...');
  const supabase = require('./lib/supabase');
  const nowIso = new Date().toISOString();
  const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  try {
    // Quedadas con fecha de fin ya pasada
    await supabase
      .from('hangout_pools')
      .delete()
      .not('ends_at', 'is', null)
      .lt('ends_at', nowIso);

    // Quedadas sin fecha de fin, creadas hace más de 2 horas
    await supabase
      .from('hangout_pools')
      .delete()
      .is('ends_at', null)
      .lt('created_at', twoHoursAgoIso);
  } catch (err) {
    console.error('[CRON] Pool deletion failed:', err);
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
  console.log(`🔋 SocialBattery server running on port ${PORT} (Phase 11) — instance pid:${INSTANCE_ID}`);
  console.log(`[NOTIF-CAP] Si en los logs de Railway ves más de un "pid:" distinto sirviendo ticks a la vez, hay 2 procesos activos — revisa Railway → Settings y apaga el deploy sobrante.`);
});
