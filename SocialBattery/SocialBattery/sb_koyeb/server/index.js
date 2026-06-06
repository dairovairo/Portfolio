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

const app = express();
const PORT = process.env.PORT || 3001;

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

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔋 SocialBattery server running on port ${PORT} (Phase 11)`);
});
