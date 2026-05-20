const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/badges — full catalog
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('badges')
    .select('*')
    .order('category');

  if (error) return res.status(500).json({ error: 'Failed to fetch badges' });
  res.json({ badges: data });
});

// GET /api/badges/my — current user's earned badges with full badge info
router.get('/my', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('user_badges')
    .select(`
      earned_at,
      badge:badge_id(id, name, emoji, description, category)
    `)
    .eq('user_id', req.user.id)
    .order('earned_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch user badges' });
  res.json({ badges: data });
});

// GET /api/badges/user/:userId — public earned badges for a specific user
router.get('/user/:userId', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('user_badges')
    .select(`
      earned_at,
      badge:badge_id(id, name, emoji, description, category)
    `)
    .eq('user_id', req.params.userId)
    .order('earned_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch badges' });
  res.json({ badges: data });
});

module.exports = router;
