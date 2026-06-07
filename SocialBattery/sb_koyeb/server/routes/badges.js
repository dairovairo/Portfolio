const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { CIRCLE_BADGES, computeCircleBadges, computeGroupBadges } = require('../lib/circleBadges');
const supabase = require('../lib/supabase');

function toEarnedBadge(assignment) {
  return {
    earned_at: assignment.earned_at,
    score: assignment.score,
    strength: assignment.strength,
    reason: assignment.reason,
    holder: assignment.user,
    badge: assignment.badge,
  };
}

// GET /api/badges — catálogo de insignias de círculo
router.get('/', requireAuth, async (_req, res) => {
  res.json({ badges: CIRCLE_BADGES });
});

// GET /api/badges/circle — títulos del círculo completo de amigos (legacy/compatibilidad)
router.get('/circle', requireAuth, async (req, res) => {
  try {
    const result = await computeCircleBadges(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('[BADGES] circle error:', error);
    res.status(500).json({ error: 'Failed to compute circle badges' });
  }
});

// GET /api/badges/group/:groupId — insignias activas de un grupo privado
// Calcula los titulares actuales y persiste los logros permanentes
router.get('/group/:groupId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;

  try {
    // Verificar que el usuario es miembro del grupo
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const result = await computeGroupBadges(groupId);
    res.json(result);
  } catch (error) {
    console.error('[BADGES] group error:', error);
    res.status(500).json({ error: 'Failed to compute group badges' });
  }
});

// GET /api/badges/my — insignias permanentes del usuario actual (ganadas en cualquier grupo)
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_badges')
      .select('earned_at, badge:badge_id(id, name, emoji, description, category)')
      .eq('user_id', req.user.id)
      .order('earned_at', { ascending: false });

    if (error) throw error;
    res.json({ badges: data || [] });
  } catch (error) {
    console.error('[BADGES] my error:', error);
    res.status(500).json({ error: 'Failed to fetch user badges' });
  }
});

// GET /api/badges/user/:userId — insignias permanentes de otro usuario
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.userId;

    // Check show_badges privacy setting (skip when viewing own badges)
    if (req.user.id !== targetId) {
      const { data: privacyRow } = await supabase
        .from('users')
        .select('show_badges')
        .eq('id', targetId)
        .single();
      if (privacyRow && privacyRow.show_badges === false) {
        return res.json({ badges: [] });
      }
    }

    const { data, error } = await supabase
      .from('user_badges')
      .select('earned_at, badge:badge_id(id, name, emoji, description, category)')
      .eq('user_id', targetId)
      .order('earned_at', { ascending: false });

    if (error) throw error;
    res.json({ badges: data || [] });
  } catch (error) {
    console.error('[BADGES] user error:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

module.exports = router;
