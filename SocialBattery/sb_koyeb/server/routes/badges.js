const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { CIRCLE_BADGES, computeCircleBadges } = require('../lib/circleBadges');

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

// GET /api/badges — circle badge catalog
router.get('/', requireAuth, async (_req, res) => {
  res.json({ badges: CIRCLE_BADGES });
});

// GET /api/badges/circle — current user's friend-circle titles
router.get('/circle', requireAuth, async (req, res) => {
  try {
    const result = await computeCircleBadges(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('[BADGES] circle error:', error);
    res.status(500).json({ error: 'Failed to compute circle badges' });
  }
});

// GET /api/badges/my — current user's active circle titles
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await computeCircleBadges(req.user.id);
    const badges = result.assignments
      .filter(assignment => assignment.userId === req.user.id)
      .map(toEarnedBadge);
    res.json({ badges });
  } catch (error) {
    console.error('[BADGES] my error:', error);
    res.status(500).json({ error: 'Failed to compute user badges' });
  }
});

// GET /api/badges/user/:userId — titles for a user inside my friend circle
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const result = await computeCircleBadges(req.user.id);
    const isInCircle = result.members.some(member => member.id === req.params.userId);

    if (!isInCircle) {
      return res.json({ badges: [] });
    }

    const badges = result.assignments
      .filter(assignment => assignment.userId === req.params.userId)
      .map(toEarnedBadge);
    res.json({ badges });
  } catch (error) {
    console.error('[BADGES] user error:', error);
    res.status(500).json({ error: 'Failed to compute badges' });
  }
});

module.exports = router;
