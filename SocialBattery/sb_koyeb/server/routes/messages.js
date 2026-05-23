const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/messages — list conversations (all accepted friends, with last message if any)
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // 1. Fetch all accepted friends
  const { data: friendships, error: fErr } = await supabase
    .from('friendships')
    .select(`
      requester:requester_id(id, username, display_name, avatar_url, battery_level, last_seen_at),
      addressee:addressee_id(id, username, display_name, avatar_url, battery_level, last_seen_at)
    `)
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (fErr) return res.status(500).json({ error: 'Failed to fetch friends' });

  // Build a map of friendId -> friend profile
  const friendsMap = {};
  (friendships || []).forEach(f => {
    const friend = f.requester?.id === userId ? f.addressee : f.requester;
    if (friend) friendsMap[friend.id] = friend;
  });

  // 2. Fetch last messages (only with current friends)
  const { data: messages, error: mErr } = await supabase
    .from('messages')
    .select(`
      id, content, type, hangout_status, created_at, read_at,
      sender:sender_id(id, username, display_name, avatar_url, battery_level, last_seen_at),
      receiver:receiver_id(id, username, display_name, avatar_url, battery_level, last_seen_at)
    `)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(300);

  if (mErr) return res.status(500).json({ error: 'Failed to fetch conversations' });

  // 3. Build conversation map from messages, but only for current friends
  const convMap = {};
  (messages || []).forEach(msg => {
    const isMe = msg.sender.id === userId;
    const partner = isMe ? msg.receiver : msg.sender;
    // Skip if no longer friends
    if (!friendsMap[partner.id]) return;
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

  // 4. Add friends that have no messages yet (new friendships)
  Object.entries(friendsMap).forEach(([friendId, friend]) => {
    if (!convMap[friendId]) {
      convMap[friendId] = {
        partner: friend,
        lastMessage: null,
        unread: 0,
      };
    }
  });

  res.json({ conversations: Object.values(convMap) });
});

// GET /api/messages/:friendId — conversation with a user
router.get('/:friendId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;
  const limit = parseInt(req.query.limit) || 60;
  const before = req.query.before; // cursor-based pagination

  let query = supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),` +
      `and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
    )
    .order('created_at', { ascending: true })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: 'Failed to fetch messages' });
  res.json({ messages: data });
});

// POST /api/messages — send a message
router.post('/', requireAuth, async (req, res) => {
  const { receiver_id, content, type = 'text', hangout_time } = req.body;
  const senderId = req.user.id;

  if (!receiver_id || !content?.trim()) {
    return res.status(400).json({ error: 'receiver_id and content are required' });
  }
  if (!['text', 'hangout_request'].includes(type)) {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  // Verify they are friends
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
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to send message' });
  res.status(201).json({ message: data });
});

// PATCH /api/messages/:messageId/hangout — accept or reject a hangout request
router.patch('/:messageId/hangout', requireAuth, async (req, res) => {
  const { status } = req.body; // 'accepted' | 'rejected'
  const userId = req.user.id;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' });
  }

  // Only the receiver can respond to a hangout request
  const { data: msg } = await supabase
    .from('messages')
    .select('id, sender_id, receiver_id, type, hangout_status')
    .eq('id', req.params.messageId)
    .eq('receiver_id', userId)
    .eq('type', 'hangout_request')
    .single();

  if (!msg) {
    return res.status(404).json({ error: 'Hangout request not found' });
  }
  if (msg.hangout_status !== 'pending') {
    return res.status(409).json({ error: 'This request has already been answered' });
  }

  const { data, error } = await supabase
    .from('messages')
    .update({ hangout_status: status })
    .eq('id', req.params.messageId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update hangout status' });
  res.json({ message: data });
});

// PATCH /api/messages/:friendId/read — mark messages from friend as read
router.patch('/:friendId/read', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;

  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', friendId)
    .eq('receiver_id', userId)
    .is('read_at', null);

  res.json({ success: true });
});

// PATCH /api/users/me/seen — update last_seen_at (heartbeat)
router.patch('/heartbeat', requireAuth, async (req, res) => {
  await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);

  res.json({ success: true });
});

module.exports = router;
