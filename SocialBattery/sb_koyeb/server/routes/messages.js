const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { applyBatteryExpiry } = require('../lib/batteryExpiry');
const { createImageUpload, storeImage } = require('../lib/imageUpload');

// Multer instance for chat image uploads (8 MB max)
const _dmImageUpload = createImageUpload({ maxSizeMb: 8 }).single('image');

const MESSAGE_FIELDS = `
  id, sender_id, receiver_id, content, type, hangout_status, hangout_time,
  read_at, delivered_at, deleted_for_self, deleted_for_everyone,
  deleted_for_everyone_at, created_at
`;

// ── GET /api/messages/unread-count — lightweight unread badge count ───────────
// Returns a single integer. Used by HomePage/BottomNav to show the badge.
// Replaces the old pattern of GET /messages (300 rows) just to reduce to a number.
router.get('/unread-count', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Count messages received by this user that haven't been read yet,
  // excluding messages deleted for everyone or for this user.
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', userId)
    .is('read_at', null)
    .not('deleted_for_everyone', 'is', true);

  if (error) return res.status(500).json({ error: 'Failed to count unread messages' });
  res.json({ count: count || 0 });
});

// ── GET /api/messages — list conversations ────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data: friendships, error: fErr } = await supabase
    .from('friendships')
    .select(`
      requester:requester_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at),
      addressee:addressee_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at)
    `)
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (fErr) return res.status(500).json({ error: 'Failed to fetch friends' });

  const friendsMap = {};
  (friendships || []).forEach(f => {
    const friend = f.requester?.id === userId ? f.addressee : f.requester;
    if (friend) friendsMap[friend.id] = applyBatteryExpiry(friend);
  });

  const { data: messages, error: mErr } = await supabase
    .from('messages')
    .select(`
      id, content, type, hangout_status, created_at, read_at, delivered_at,
      deleted_for_everyone, deleted_for_self,
      sender:sender_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at),
      receiver:receiver_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at)
    `)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(300);

  if (mErr) return res.status(500).json({ error: 'Failed to fetch conversations' });

  const convMap = {};
  (messages || []).forEach(msg => {
    const isMe = msg.sender.id === userId;
    const partner = applyBatteryExpiry(isMe ? msg.receiver : msg.sender);
    if (!friendsMap[partner.id]) return;

    // Skip messages deleted for me
    const deletedForMe = Array.isArray(msg.deleted_for_self) && msg.deleted_for_self.includes(userId);
    if (deletedForMe) return;

    if (!convMap[partner.id]) {
      convMap[partner.id] = {
        partner,
        lastMessage: msg,
        unread: !isMe && !msg.read_at ? 1 : 0,
      };
    } else if (!isMe && !msg.read_at) {
      convMap[partner.id].unread++;
    }
  });

  Object.entries(friendsMap).forEach(([friendId, friend]) => {
    if (!convMap[friendId]) {
      convMap[friendId] = { partner: friend, lastMessage: null, unread: 0 };
    }
  });

  res.json({ conversations: Object.values(convMap) });
});

// ── GET /api/messages/:friendId — conversation messages ───────────────────────
router.get('/:friendId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;
  const limit = parseInt(req.query.limit) || 60;
  const before = req.query.before;

  let query = supabase
    .from('messages')
    .select(MESSAGE_FIELDS)
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),` +
      `and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
    )
    .order('created_at', { ascending: true })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to fetch messages' });

  // Mark undelivered messages from friend as delivered
  const undeliveredIds = (data || [])
    .filter(m => m.sender_id === friendId && m.receiver_id === userId && !m.delivered_at)
    .map(m => m.id);

  if (undeliveredIds.length > 0) {
    await supabase
      .from('messages')
      .update({ delivered_at: new Date().toISOString() })
      .in('id', undeliveredIds);

    // Update local copy
    const now = new Date().toISOString();
    data.forEach(m => {
      if (undeliveredIds.includes(m.id)) m.delivered_at = now;
    });
  }

  // Fetch cleared_at for this user+partner
  const { data: clearData } = await supabase
    .from('conversation_clears')
    .select('cleared_at')
    .eq('user_id', userId)
    .eq('partner_id', friendId)
    .maybeSingle();

  res.json({ messages: data, cleared_at: clearData?.cleared_at || null });
});

// ── POST /api/messages — send message ────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { receiver_id, content, type = 'text', hangout_time } = req.body;
  const senderId = req.user.id;

  if (!receiver_id || !content?.trim()) {
    return res.status(400).json({ error: 'receiver_id and content are required' });
  }
  if (!['text', 'hangout_request'].includes(type)) {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  const { data: friendship } = await supabase
    .from('friendships')
    .select('id')
    .eq('status', 'accepted')
    .or(
      `and(requester_id.eq.${senderId},addressee_id.eq.${receiver_id}),` +
      `and(requester_id.eq.${receiver_id},addressee_id.eq.${senderId})`
    )
    .single();

  if (!friendship) {
    return res.status(403).json({ error: 'Solo puedes enviar mensajes a amigos' });
  }

  const insertData = {
    sender_id: senderId,
    receiver_id,
    content: content.trim(),
    type,
  };

  if (type === 'hangout_request') {
    insertData.hangout_status = 'pending';
    if (hangout_time) insertData.hangout_time = hangout_time.trim();
  }

  const { data, error } = await supabase
    .from('messages')
    .insert(insertData)
    .select(MESSAGE_FIELDS)
    .single();

  if (error) return res.status(500).json({ error: 'Failed to send message' });
  res.status(201).json({ message: data });
});

// ── PATCH /api/messages/:friendId/deliver — mark messages as delivered ────────
router.patch('/:friendId/deliver', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;

  await supabase
    .from('messages')
    .update({ delivered_at: new Date().toISOString() })
    .eq('sender_id', friendId)
    .eq('receiver_id', userId)
    .is('delivered_at', null);

  res.json({ success: true });
});

// ── PATCH /api/messages/:friendId/read — mark messages as read ────────────────
router.patch('/:friendId/read', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;
  const now = new Date().toISOString();

  // Set both delivered_at and read_at
  await supabase
    .from('messages')
    .update({ delivered_at: now, read_at: now })
    .eq('sender_id', friendId)
    .eq('receiver_id', userId)
    .is('read_at', null);

  res.json({ success: true });
});

// ── PATCH /api/messages/:messageId/hangout — respond to hangout request ───────
router.patch('/:messageId/hangout', requireAuth, async (req, res) => {
  const { status } = req.body;
  const userId = req.user.id;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' });
  }

  const { data: msg } = await supabase
    .from('messages')
    .select('id, sender_id, receiver_id, type, hangout_status')
    .eq('id', req.params.messageId)
    .eq('receiver_id', userId)
    .eq('type', 'hangout_request')
    .single();

  if (!msg) return res.status(404).json({ error: 'Hangout request not found' });
  if (msg.hangout_status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been answered' });
  }

  const { data, error } = await supabase
    .from('messages')
    .update({ hangout_status: status })
    .eq('id', req.params.messageId)
    .select(MESSAGE_FIELDS)
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update hangout status' });
  res.json({ message: data });
});

// ── PATCH /api/messages/message/:messageId — delete a message ─────────────────
// scope: 'me' → solo para mí | 'everyone' → para todos (solo sender, deja rastro)
router.patch('/message/:messageId', requireAuth, async (req, res) => {
  const { scope } = req.body;
  const userId = req.user.id;

  if (!['me', 'everyone'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be "me" or "everyone"' });
  }

  const { data: msg, error: fetchErr } = await supabase
    .from('messages')
    .select('id, sender_id, receiver_id, deleted_for_self')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq('id', req.params.messageId)
    .single();

  if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });

  if (scope === 'everyone') {
    if (msg.sender_id !== userId) {
      return res.status(403).json({ error: 'Solo puedes eliminar para todos tus propios mensajes' });
    }
    const { data, error } = await supabase
      .from('messages')
      .update({
        deleted_for_everyone: true,
        deleted_for_everyone_at: new Date().toISOString(),
      })
      .eq('id', req.params.messageId)
      .select(MESSAGE_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: 'Failed to delete message' });
    return res.json({ message: data });
  } else {
    // Add userId to deleted_for_self array
    const current = Array.isArray(msg.deleted_for_self) ? msg.deleted_for_self : [];
    if (!current.includes(userId)) current.push(userId);

    const { data, error } = await supabase
      .from('messages')
      .update({ deleted_for_self: current })
      .eq('id', req.params.messageId)
      .select(MESSAGE_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: 'Failed to delete message' });
    return res.json({ message: data });
  }
});

// ── POST /api/messages/chat/:friendId/clear — vaciar conversación ─────────────
router.post('/chat/:friendId/clear', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;

  const { error } = await supabase
    .from('conversation_clears')
    .upsert(
      { user_id: userId, partner_id: friendId, cleared_at: new Date().toISOString() },
      { onConflict: 'user_id,partner_id' }
    );

  if (error) return res.status(500).json({ error: 'Failed to clear conversation' });
  res.json({ success: true, cleared_at: new Date().toISOString() });
});

// ── PATCH /api/messages/heartbeat ────────────────────────────────────────────
router.patch('/heartbeat', requireAuth, async (req, res) => {
  await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);

  res.json({ success: true });
});

// ── POST /api/messages/:receiverId/image — send an image in a DM ─────────────
router.post('/:receiverId/image', requireAuth, (req, res, next) => {
  _dmImageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const senderId = req.user.id;
  const { receiverId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: 'Se requiere una imagen' });
  }

  // Verify friendship before sending
  const { data: friendship } = await supabase
    .from('friendships')
    .select('id')
    .eq('status', 'accepted')
    .or(
      `and(requester_id.eq.${senderId},addressee_id.eq.${receiverId}),` +
      `and(requester_id.eq.${receiverId},addressee_id.eq.${senderId})`
    )
    .single();

  if (!friendship) {
    return res.status(403).json({ error: 'Solo puedes enviar mensajes a amigos' });
  }

  try {
    const imageUrl = await storeImage({
      file: req.file,
      bucket: 'chat-images',
      objectName: `dm/${senderId}/${Date.now()}`,
      fallbackMaxLength: 8_000_000,
    });

    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content: imageUrl,
        type: 'image',
      })
      .select(MESSAGE_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: 'Failed to save image message' });
    res.status(201).json({ message: data });
  } catch (e) {
    console.error('[MESSAGES] image upload error:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Error al subir la imagen' });
  }
});

module.exports = router;
