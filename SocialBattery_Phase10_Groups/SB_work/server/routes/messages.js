const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/messages — list conversations (last message per friend)
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('messages')
    .select(`
      id, content, type, hangout_status, created_at, read_at,
      sender:sender_id(id, username, display_name, avatar_url, battery_level, last_seen_at),
      receiver:receiver_id(id, username, display_name, avatar_url, battery_level, last_seen_at)
    `)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) return res.status(500).json({ error: 'Failed to fetch conversations' });

  // Group by partner, keep only latest message, count unread
  const convMap = {};
  (data || []).forEach(msg => {
    const isMe = msg.sender.id === userId;
    const partner = isMe ? msg.receiver : msg.sender;
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
