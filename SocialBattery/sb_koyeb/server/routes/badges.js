const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { CIRCLE_BADGES, computeCircleBadges, computeGroupBadges, computePoolBadges } = require('../lib/circleBadges');
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

// GET /api/badges/pool/:poolId — insignias activas de los apuntados a una quedada
// Calcula los titulares actuales y persiste los logros permanentes
router.get('/pool/:poolId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { poolId } = req.params;

  try {
    // Verificar que el usuario está apuntado a la quedada (o es quien la creó)
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id')
      .eq('id', poolId)
      .maybeSingle();

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    const { data: participation } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!participation && pool.creator_id !== userId) {
      return res.status(403).json({ error: 'Not a participant of this pool' });
    }

    const result = await computePoolBadges(poolId);
    res.json(result);
  } catch (error) {
    console.error('[BADGES] pool error:', error);
    res.status(500).json({ error: 'Failed to compute pool badges' });
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
    const { data, error } = await supabase
      .from('user_badges')
      .select('earned_at, badge:badge_id(id, name, emoji, description, category)')
      .eq('user_id', req.params.userId)
      .order('earned_at', { ascending: false });

    if (error) throw error;
    res.json({ badges: data || [] });
  } catch (error) {
    console.error('[BADGES] user error:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

module.exports = router;
