const supabase = require('./supabase');

const BATTERY_TTL_MS = 24 * 60 * 60 * 1000;

function isBatteryExpired(updatedAt, now = Date.now()) {
  if (!updatedAt) return true;
  const updatedTime = new Date(updatedAt).getTime();
  return Number.isNaN(updatedTime) || now - updatedTime >= BATTERY_TTL_MS;
}

function applyBatteryExpiry(user, now = Date.now()) {
  if (!user) return user;
  if (!isBatteryExpired(user.battery_updated_at, now)) {
    return { ...user, battery_expired: false };
  }

  return {
    ...user,
    battery_level: 0,
    battery_is_estimated: false,
    battery_expired: true,
  };
}

function applyBatteryExpiryToUsers(users = [], now = Date.now()) {
  return (users || []).map(user => applyBatteryExpiry(user, now));
}

async function expireUserBatteryIfNeeded(userOrId) {
  let user = userOrId;
  if (typeof userOrId === 'string') {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userOrId)
      .single();

    if (error) throw error;
    user = data;
  }

  if (!user || !isBatteryExpired(user.battery_updated_at)) {
    return user ? { ...user, battery_expired: false } : user;
  }

  if (user.battery_level !== 0 || user.battery_is_estimated) {
    const { data, error } = await supabase
      .from('users')
      .update({ battery_level: 0, battery_is_estimated: false })
      .eq('id', user.id)
      .select()
      .single();

    if (!error && data) user = data;
  }

  return applyBatteryExpiry(user);
}

async function expireStaleBatteries() {
  const cutoff = new Date(Date.now() - BATTERY_TTL_MS).toISOString();
  const { error } = await supabase
    .from('users')
    .update({ battery_level: 0, battery_is_estimated: false })
    .or(`battery_updated_at.is.null,battery_updated_at.lt.${cutoff}`);

  if (error) throw error;
}

module.exports = {
  BATTERY_TTL_MS,
  isBatteryExpired,
  applyBatteryExpiry,
  applyBatteryExpiryToUsers,
  expireUserBatteryIfNeeded,
  expireStaleBatteries,
};
