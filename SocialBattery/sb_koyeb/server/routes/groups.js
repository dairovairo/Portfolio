const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { applyBatteryExpiry, applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');
const { createImageUpload, storeImage } = require('../lib/imageUpload');
const { notifyUsers } = require('../lib/webpush');

// Multer instance for group chat image uploads (8 MB max)
const _groupImageUpload = createImageUpload({ maxSizeMb: 8 }).single('image');

// ── Push helper — notifica a los miembros del grupo (excepto el emisor) ──────
async function sendGroupPush(groupId, senderId, senderName, bodyText) {
  try {
    const { data: members } = await supabase
      .from('friend_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .neq('user_id', senderId);

    if (!members?.length) return;

    const { data: group } = await supabase
      .from('friend_groups')
      .select('name')
      .eq('id', groupId)
      .single();

    const groupName = group?.name || 'Grupo';
    const memberIds = members.map(m => m.user_id);

    await notifyUsers(supabase, memberIds, senderId, {
      title: groupName,
      body:  `${senderName}: ${bodyText}`,
      url:   `/messages/group/${groupId}`,
      tag:   `group-${groupId}`,
    });
  } catch (e) {
    console.warn('[GROUPS] sendGroupPush error:', e.message);
  }
}


// ── GET /api/groups — list my groups (owned + member) ───────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { data, error } = await supabase
      .from('friend_group_members')
      .select(`
        group:group_id(
          id, name, created_at,
          owner:owner_id(id, username, display_name, avatar_url),
          friend_group_members(
            user:user_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
          )
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    const groups = (data || [])
      .map(row => {
        const g = row.group;
        if (!g) return null;
        const members = applyBatteryExpiryToUsers((g.friend_group_members || []).map(m => m.user).filter(Boolean));
        return {
          id: g.id,
          name: g.name,
          created_at: g.created_at,
          owner: g.owner,
          members,
          member_count: members.length,
          is_owner: g.owner?.id === userId,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Fetch only the last message for each group. Pulling all group messages here
    // makes the inbox/home endpoints grow with chat history and burns PostgREST egress.
    if (groups.length > 0) {
      const lastMessageResults = await Promise.all(
        groups.map(group =>
          supabase
            .from('group_messages')
            .select('group_id, created_at, sender_id, content, type')
            .eq('group_id', group.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );

      groups.forEach((group, index) => {
        groups[index].last_message = lastMessageResults[index].data || null;
      });
    }

    res.json({ groups });
  } catch (err) {
    console.error('[GROUPS] GET /', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// ── GET /api/groups/unread-counts — count unread messages per group ──────────
router.get('/unread-counts', requireAuth, async (req, res) => {
  const userId = req.user.id;
  let reads = {};
  try { reads = JSON.parse(req.query.reads || '{}'); } catch {}

  try {
    // Get all groups this user belongs to
    const { data: memberships } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('user_id', userId);

    const groupIds = (memberships || []).map(m => m.group_id);
    if (groupIds.length === 0) return res.json({ counts: {} });

    const counts = {};
    await Promise.all(groupIds.map(async (groupId) => {
      const since = reads[groupId];
      let query = supabase
        .from('group_messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .neq('sender_id', userId);
      if (since) query = query.gt('created_at', since);
      const { count } = await query;
      counts[groupId] = count || 0;
    }));

    res.json({ counts });
  } catch (err) {
    console.error('[GROUPS] GET /unread-counts', err);
    res.status(500).json({ error: 'Failed to fetch unread counts' });
  }
});

// ── POST /api/groups — create a group ───────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { name, member_ids = [] } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (name.trim().length > 60) return res.status(400).json({ error: 'name too long' });

  try {
    // Create group
    const { data: group, error: gErr } = await supabase
      .from('friend_groups')
      .insert({ owner_id: userId, name: name.trim() })
      .select('id, name, created_at')
      .single();

    if (gErr) throw gErr;

    // Add owner + chosen members (deduplicate, exclude non-friends if needed)
    const allMemberIds = [...new Set([userId, ...member_ids.filter(id => id !== userId)])];
    const memberRows = allMemberIds.map(uid => ({ group_id: group.id, user_id: uid }));

    const { error: mErr } = await supabase
      .from('friend_group_members')
      .insert(memberRows);

    if (mErr) throw mErr;

    res.status(201).json({ group: { ...group, member_count: allMemberIds.length } });
  } catch (err) {
    console.error('[GROUPS] POST /', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// ── GET /api/groups/:id — group detail with members ─────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    // Check membership
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('group_id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Not a member of this group' });

    const { data: group, error } = await supabase
      .from('friend_groups')
      .select(`
        id, name, created_at,
        owner:owner_id(id, username, display_name, avatar_url),
        friend_group_members(
          joined_at,
          user:user_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at)
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !group) return res.status(404).json({ error: 'Group not found' });

    const members = applyBatteryExpiryToUsers((group.friend_group_members || []).map(m => m.user).filter(Boolean));
    res.json({
      group: {
        ...group,
        friend_group_members: undefined,
        members,
        member_count: members.length,
        is_owner: group.owner?.id === userId,
      }
    });
  } catch (err) {
    console.error('[GROUPS] GET /:id', err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// ── PATCH /api/groups/:id — rename group (owner only) ───────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const { data, error } = await supabase
      .from('friend_groups')
      .update({ name: name.trim() })
      .eq('id', req.params.id)
      .eq('owner_id', userId)
      .select()
      .single();

    if (error || !data) return res.status(403).json({ error: 'Not the owner or group not found' });
    res.json({ group: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// ── POST /api/groups/:id/members — add member (owner only) ──────────────────
router.post('/:id/members', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  try {
    // Verify ownership
    const { data: grp } = await supabase
      .from('friend_groups')
      .select('id')
      .eq('id', req.params.id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (!grp) return res.status(403).json({ error: 'Not the owner' });

    const { error } = await supabase
      .from('friend_group_members')
      .insert({ group_id: req.params.id, user_id });

    if (error?.code === '23505') return res.status(409).json({ error: 'Already a member' });
    if (error) throw error;

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ── DELETE /api/groups/:id/members/:userId — remove member ──────────────────
router.delete('/:id/members/:memberId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: groupId, memberId } = req.params;

  try {
    // Owner can remove anyone; member can remove themselves
    const { data: grp } = await supabase
      .from('friend_groups')
      .select('owner_id')
      .eq('id', groupId)
      .single();

    if (!grp) return res.status(404).json({ error: 'Group not found' });
    if (grp.owner_id !== userId && memberId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    // Owner cannot remove themselves (would orphan the group)
    if (memberId === grp.owner_id && memberId === userId) {
      return res.status(400).json({ error: 'Owner cannot leave; delete the group instead' });
    }

    await supabase
      .from('friend_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', memberId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ── DELETE /api/groups/:id — delete group (owner only) ──────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { error } = await supabase
      .from('friend_groups')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ── GET /api/groups/:id/messages ─────────────────────────────────────────────
router.get('/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 60;

  try {
    // Check membership
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('group_id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const { data, error } = await supabase
      .from('group_messages')
      .select(`
        id, content, type, created_at,
        sender:sender_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .eq('group_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    res.json({
      messages: (data || []).map(message => ({
        ...message,
        sender: applyBatteryExpiry(message.sender),
      })),
    });
  } catch (err) {
    console.error('[GROUPS] GET /:id/messages', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ── POST /api/groups/:id/messages ────────────────────────────────────────────
router.post('/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { content, type = 'text' } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (!['text', 'hangout_request'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  try {
    // Check membership
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('group_id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const { data, error } = await supabase
      .from('group_messages')
      .insert({ group_id: req.params.id, sender_id: userId, content: content.trim(), type })
      .select(`
        id, content, type, created_at,
        sender:sender_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    const sender = applyBatteryExpiry(data.sender);
    res.status(201).json({ message: { ...data, sender } });

    // ── Push a los demás miembros (fire-and-forget) ──────────────────────────
    const senderName = sender?.display_name || (sender?.username ? `@${sender.username}` : 'Alguien');
    const pushBody = type === 'hangout_request'
      ? `${senderName} propone una quedada 🤝`
      : content.trim().length > 80 ? content.trim().slice(0, 77) + '…' : content.trim();
    sendGroupPush(req.params.id, userId, senderName, pushBody).catch(() => {});
  } catch (err) {
    console.error('[GROUPS] POST /:id/messages', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── POST /api/groups/:id/messages/image — send an image to a group chat ───────
router.post('/:id/messages/image', requireAuth, (req, res, next) => {
  _groupImageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Se requiere una imagen' });
  }

  try {
    // Verify membership
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Not a member' });

    const imageUrl = await storeImage({
      file: req.file,
      bucket: 'chat-images',
      objectName: `group/${groupId}/${Date.now()}`,
      fallbackMaxLength: 8_000_000,
    });

    const { data, error } = await supabase
      .from('group_messages')
      .insert({
        group_id: groupId,
        sender_id: userId,
        content: imageUrl,
        type: 'image',
      })
      .select(`
        id, content, type, created_at,
        sender:sender_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    const sender = applyBatteryExpiry(data.sender);
    res.status(201).json({ message: { ...data, sender } });

    // ── Push a los demás miembros (fire-and-forget) ──────────────────────────
    const senderName = sender?.display_name || (sender?.username ? `@${sender.username}` : 'Alguien');
    sendGroupPush(groupId, userId, senderName, '📷 Imagen').catch(() => {});
  } catch (e) {
    console.error('[GROUPS] image upload error:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Error al subir la imagen' });
  }
});

module.exports = router;
