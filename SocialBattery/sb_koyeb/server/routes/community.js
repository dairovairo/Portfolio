const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// ── GET /api/community/events ─────────────────────────────────────────────────
// Returns all events sorted by attendee_count DESC
router.get('/events', requireAuth, async (req, res) => {
  try {
    const { data: events, error } = await supabase
      .from('community_events')
      .select(`
        id, title, description, category, event_date, location,
        max_attendees, creator_id, created_at,
        creator:users!community_events_creator_id_fkey(display_name, username)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // For each event, get attendee count and IDs
    const enriched = await Promise.all((events || []).map(async (ev) => {
      const { data: attendees, count } = await supabase
        .from('community_event_attendees')
        .select('user_id', { count: 'exact' })
        .eq('event_id', ev.id);

      return {
        ...ev,
        creator_name: ev.creator?.display_name || ev.creator?.username || 'Alguien',
        attendee_count: count || 0,
        attendee_ids: (attendees || []).map(a => a.user_id),
      };
    }));

    // Sort by popularity (attendee_count DESC)
    enriched.sort((a, b) => b.attendee_count - a.attendee_count);

    res.json({ events: enriched });
  } catch (err) {
    console.error('[community] GET /events error:', err);
    res.status(500).json({ error: 'Error al obtener los eventos' });
  }
});

// ── POST /api/community/events ────────────────────────────────────────────────
router.post('/events', requireAuth, async (req, res) => {
  const { title, description, category, event_date, location, max_attendees } = req.body;
  const userId = req.user.id;

  if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!event_date) return res.status(400).json({ error: 'La fecha es obligatoria' });

  try {
    const { data: event, error } = await supabase
      .from('community_events')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        event_date,
        location: location?.trim() || null,
        max_attendees: max_attendees || 50,
        creator_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    // Auto-join creator as attendee
    await supabase
      .from('community_event_attendees')
      .insert({ event_id: event.id, user_id: userId });

    res.status(201).json({ event });
  } catch (err) {
    console.error('[community] POST /events error:', err);
    res.status(500).json({ error: 'Error al crear el evento' });
  }
});

// ── POST /api/community/events/:id/join ──────────────────────────────────────
router.post('/events/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: event, error: evErr } = await supabase
      .from('community_events')
      .select('id, max_attendees, event_date')
      .eq('id', id)
      .single();

    if (evErr || !event) return res.status(404).json({ error: 'Evento no encontrado' });

    if (new Date(event.event_date) < new Date()) {
      return res.status(400).json({ error: 'El evento ya ha pasado' });
    }

    // Check if already joined
    const { data: existing } = await supabase
      .from('community_event_attendees')
      .select('user_id')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Ya estás apuntado a este evento' });

    // Check capacity
    const { count } = await supabase
      .from('community_event_attendees')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    if (event.max_attendees && count >= event.max_attendees) {
      return res.status(400).json({ error: 'El evento está lleno' });
    }

    await supabase
      .from('community_event_attendees')
      .insert({ event_id: id, user_id: userId });

    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /events/:id/join error:', err);
    res.status(500).json({ error: 'Error al apuntarse al evento' });
  }
});

// ── GET /api/community/communities ───────────────────────────────────────────
router.get('/communities', requireAuth, async (req, res) => {
  try {
    const { data: communities, error } = await supabase
      .from('communities')
      .select(`
        id, name, description, category, creator_id, created_at,
        creator:users!communities_creator_id_fkey(display_name, username)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = await Promise.all((communities || []).map(async (comm) => {
      const { data: members, count } = await supabase
        .from('community_members')
        .select('user_id', { count: 'exact' })
        .eq('community_id', comm.id);

      return {
        ...comm,
        creator_name: comm.creator?.display_name || comm.creator?.username || 'Alguien',
        member_count: count || 0,
        member_ids: (members || []).map(m => m.user_id),
      };
    }));

    res.json({ communities: enriched });
  } catch (err) {
    console.error('[community] GET /communities error:', err);
    res.status(500).json({ error: 'Error al obtener las comunidades' });
  }
});

// ── POST /api/community/communities ─────────────────────────────────────────
router.post('/communities', requireAuth, async (req, res) => {
  const { name, description, category } = req.body;
  const userId = req.user.id;

  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  try {
    const { data: community, error } = await supabase
      .from('communities')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        creator_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    // Auto-join creator as member
    await supabase
      .from('community_members')
      .insert({ community_id: community.id, user_id: userId });

    res.status(201).json({ community });
  } catch (err) {
    console.error('[community] POST /communities error:', err);
    res.status(500).json({ error: 'Error al crear la comunidad' });
  }
});

// ── POST /api/community/communities/:id/join ─────────────────────────────────
router.post('/communities/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id')
      .eq('id', id)
      .single();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: existing } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Ya eres miembro de esta comunidad' });

    await supabase
      .from('community_members')
      .insert({ community_id: id, user_id: userId });

    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /communities/:id/join error:', err);
    res.status(500).json({ error: 'Error al unirse a la comunidad' });
  }
});

module.exports = router;
