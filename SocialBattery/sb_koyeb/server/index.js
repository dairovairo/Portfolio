require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const authRoutes    = require('./routes/auth');
const usersRoutes   = require('./routes/users');
const batteryRoutes = require('./routes/battery');
const friendsRoutes = require('./routes/friends');
const messagesRoutes = require('./routes/messages');
const badgesRoutes  = require('./routes/badges');
const poolsRoutes   = require('./routes/pools');
const { estimateBatteries } = require('./jobs/estimateBattery');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security & Middleware ──────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow image loading
}));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Higher limit for avatar uploads
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/users/avatar', uploadLimiter);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150 });
app.use('/api', limiter);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/users',    usersRoutes);
app.use('/api/battery',  batteryRoutes);
app.use('/api/friends',  friendsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/badges',   badgesRoutes);
app.use('/api/pools',    poolsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.8.0', phase: 8, timestamp: new Date().toISOString() });
});

// ── Cron Jobs ──────────────────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Running battery estimation...');
  estimateBatteries();
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

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🔋 SocialBattery server running on port ${PORT} (Phase 8)`);
  estimateBatteries().catch(console.error);
});
