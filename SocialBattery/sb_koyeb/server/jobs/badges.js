/**
 * Circle badges are dynamic titles, not permanent achievements.
 *
 * The active badge logic lives in server/lib/circleBadges.js and is exposed via
 * /api/badges/circle, /api/badges/my and /api/badges/user/:id.
 *
 * These no-op functions keep existing routes stable while preventing the old
 * permanent badge engine from mixing legacy unlocks with the circle titles.
 */

async function checkAndAwardBadges() {
  return [];
}

async function checkOrganizerBadgeForUser() {
  return null;
}

async function checkConnectorBadgeForUsers() {
  return [];
}

module.exports = {
  checkAndAwardBadges,
  checkOrganizerBadgeForUser,
  checkConnectorBadgeForUsers,
};
