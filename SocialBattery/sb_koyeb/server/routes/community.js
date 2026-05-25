const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseRequestKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

function getUserSupabase(req) {
  if (!supabaseUrl || !supabaseRequestKey || !req.token) return supabase;

  return createClient(supabaseUrl, supabaseRequestKey, {
    global: {
      headers: {
        Authorization: `Bearer ${req.token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function communityErrorMessage(err, fallback) {
  if (err?.code === '23503') {
    return 'Tu perfil no esta listo para crear contenido. Completa el perfil e intentalo de nuevo.';
  }
  if (err?.code === '42501') {
    return 'No tienes permisos para realizar esta accion.';
  }
  if (err?.code === '42P01' || err?.code === '42703') {
    return 'Falta aplicar la migracion de comunidad en Supabase.';
  }
  return fallback;
}

function fallbackDisplayName(user) {
  const fromMetadata = user.user_metadata?.display_name || user.user_metadata?.name;
  const fromEmail = user.email?.split('@')[0];
  return (fromMetadata || fromEmail || 'Usuario').trim().slice(0, 16) || 'Usuario';
}

function fallbackUsername(user) {
  const idPart = user.id.replace(/-/g, '').slice(0, 12);
  return `user_${idPart}`;
}

async function ensurePublicProfile(user) {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return;

  const { error: insertError } = await supabase
    .from('users')
    .insert({
      id: user.id,
      username: fallbackUsername(user),
      display_name: fallbackDisplayName(user),
    });

  if (!insertError) return;

  const { data: afterInsert } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!afterInsert) throw insertError;
}

async function getCommunityAdminState(communityId, userId) {
  const { data: community, error: communityError } = await supabase
    .from('communities')
    .select('id, creator_id')
    .eq('id', communityId)
    .single();

  if (communityError || !community) {
    return { community: null, membership: null, isAdmin: false };
  }

  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .maybeSingle();

  return {
    community,
    membership,
    isAdmin: community.creator_id === userId || membership?.role === 'admin',
  };
}

async function enrichEvents(db, events = []) {
  return Promise.all((events || []).map(async (ev) => {
    const { data: attendees, count } = await db
      .from('community_event_attendees')
      .select('user_id', { count: 'exact' })
      .eq('event_id', ev.id);

    return {
      ...ev,
      creator_name: ev.creator?.display_name || ev.creator?.username || 'Alguien',
      community_name: ev.community?.name || null,
      organization: ev.community?.organization || null,
      attendee_count: count || 0,
      attendee_ids: (attendees || []).map(a => a.user_id),
    };
  }));
}

function splitEventsByDate(events) {
  const now = Date.now();
  const current_events = events.filter(ev => new Date(ev.event_date).getTime() >= now);
  const past_events = events
    .filter(ev => new Date(ev.event_date).getTime() < now)
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  return { current_events, past_events };
}

// GET /api/community/events
router.get('/events', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);

  try {
    const { data: events, error } = await db
      .from('community_events')
      .select(`
        id, title, description, category, event_date, location,
        max_attendees, creator_id, community_id, created_at,
        creator:users!community_events_creator_id_fkey(display_name, username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = await enrichEvents(db, events || []);
    enriched.sort((a, b) => b.attendee_count - a.attendee_count);

    res.json({ events: enriched });
  } catch (err) {
    console.error('[community] GET /events error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener los eventos') });
  }
});

// POST /api/community/events
router.post('/events', requireAuth, async (req, res) => {
  const { title, description, category, event_date, location, max_attendees, community_id } = req.body;
  const userId = req.user.id;

  if (!title?.trim()) return res.status(400).json({ error: 'El titulo es obligatorio' });
  if (!event_date) return res.status(400).json({ error: 'La fecha es obligatoria' });
  if (Number.isNaN(new Date(event_date).getTime())) {
    return res.status(400).json({ error: 'La fecha no es valida' });
  }

  const maxAttendees = Number.parseInt(max_attendees, 10) || 50;
  if (maxAttendees < 2 || maxAttendees > 10000) {
    return res.status(400).json({ error: 'El maximo de asistentes debe estar entre 2 y 10000' });
  }

  try {
    await ensurePublicProfile(req.user);

    const communityId = community_id || null;
    if (communityId) {
      const { community, isAdmin } = await getCommunityAdminState(communityId, userId);
      if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
      if (!isAdmin) {
        return res.status(403).json({ error: 'Solo el administrador puede publicar eventos en esta comunidad' });
      }
    }

    const { data: event, error } = await supabase
      .from('community_events')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        event_date,
        location: location?.trim() || null,
        max_attendees: maxAttendees,
        creator_id: userId,
        community_id: communityId,
      })
      .select()
      .single();

    if (error) throw error;

    const { error: attendeeError } = await supabase
      .from('community_event_attendees')
      .upsert(
        { event_id: event.id, user_id: userId },
        { onConflict: 'event_id,user_id', ignoreDuplicates: true }
      );

    if (attendeeError) {
      console.warn('[community] event creator auto-join error:', attendeeError);
    }

    res.status(201).json({ event });
  } catch (err) {
    console.error('[community] POST /events error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear el evento') });
  }
});

// POST /api/community/events/:id/join
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

    const { data: existing } = await supabase
      .from('community_event_attendees')
      .select('user_id')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Ya estas apuntado a este evento' });

    const { count } = await supabase
      .from('community_event_attendees')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    if (event.max_attendees && count >= event.max_attendees) {
      return res.status(400).json({ error: 'El evento esta lleno' });
    }

    const { error: joinError } = await supabase
      .from('community_event_attendees')
      .insert({ event_id: id, user_id: userId });

    if (joinError) throw joinError;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /events/:id/join error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al apuntarse al evento') });
  }
});

// POST /api/community/events/:id/leave
router.post('/events/:id/leave', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { error } = await supabase
      .from('community_event_attendees')
      .delete()
      .eq('event_id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /events/:id/leave error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al salir del evento') });
  }
});

// GET /api/community/communities
router.get('/communities', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);
  const userId = req.user.id;

  try {
    const { data: communities, error } = await db
      .from('communities')
      .select(`
        id, name, description, category, organization, creator_id, created_at,
        creator:users!communities_creator_id_fkey(display_name, username)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = await Promise.all((communities || []).map(async (comm) => {
      const { data: members, count } = await db
        .from('community_members')
        .select('user_id, role', { count: 'exact' })
        .eq('community_id', comm.id);
      const currentMembership = (members || []).find(m => m.user_id === userId);

      return {
        ...comm,
        creator_name: comm.creator?.display_name || comm.creator?.username || 'Alguien',
        member_count: count || 0,
        member_ids: (members || []).map(m => m.user_id),
        admin_ids: (members || []).filter(m => m.role === 'admin').map(m => m.user_id),
        current_user_role: comm.creator_id === userId ? 'admin' : currentMembership?.role || null,
        is_admin: comm.creator_id === userId || currentMembership?.role === 'admin',
      };
    }));

    res.json({ communities: enriched });
  } catch (err) {
    console.error('[community] GET /communities error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener las comunidades') });
  }
});

// GET /api/community/communities/:id
router.get('/communities/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const db = getUserSupabase(req);

  try {
    const { data: community, error } = await db
      .from('communities')
      .select(`
        id, name, description, category, organization, creator_id, created_at,
        creator:users!communities_creator_id_fkey(display_name, username)
      `)
      .eq('id', id)
      .single();

    if (error || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: members, count } = await db
      .from('community_members')
      .select('user_id, role, joined_at')
      .eq('community_id', id);
    const currentMembership = (members || []).find(m => m.user_id === userId);

    const { data: events, error: eventsError } = await db
      .from('community_events')
      .select(`
        id, title, description, category, event_date, location,
        max_attendees, creator_id, community_id, created_at,
        creator:users!community_events_creator_id_fkey(display_name, username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .eq('community_id', id)
      .order('event_date', { ascending: true });

    if (eventsError) throw eventsError;

    const enrichedEvents = await enrichEvents(db, events || []);
    const splitEvents = splitEventsByDate(enrichedEvents);

    res.json({
      community: {
        ...community,
        creator_name: community.creator?.display_name || community.creator?.username || 'Alguien',
        member_count: count || 0,
        member_ids: (members || []).map(m => m.user_id),
        admin_ids: (members || []).filter(m => m.role === 'admin').map(m => m.user_id),
        current_user_role: community.creator_id === userId ? 'admin' : currentMembership?.role || null,
        is_member: Boolean(currentMembership),
        is_admin: community.creator_id === userId || currentMembership?.role === 'admin',
      },
      ...splitEvents,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener la comunidad') });
  }
});

// POST /api/community/communities
router.post('/communities', requireAuth, async (req, res) => {
  const { name, description, category, organization } = req.body;
  const userId = req.user.id;

  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  try {
    await ensurePublicProfile(req.user);

    const { data: community, error } = await supabase
      .from('communities')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        organization: organization?.trim() || null,
        creator_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    const { error: memberError } = await supabase
      .from('community_members')
      .upsert(
        { community_id: community.id, user_id: userId, role: 'admin' },
        { onConflict: 'community_id,user_id', ignoreDuplicates: true }
      );

    if (memberError) {
      console.warn('[community] community creator auto-join error:', memberError);
    }

    res.status(201).json({ community });
  } catch (err) {
    console.error('[community] POST /communities error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear la comunidad') });
  }
});

// POST /api/community/communities/:id/join
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

    const { error: joinError } = await supabase
      .from('community_members')
      .insert({ community_id: id, user_id: userId, role: 'member' });

    if (joinError) throw joinError;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /communities/:id/join error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al unirse a la comunidad') });
  }
});

// POST /api/community/communities/:id/leave
router.post('/communities/:id/leave', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: membership, error: memberErr } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberErr) throw memberErr;
    if (!membership) return res.status(400).json({ error: 'No eres miembro de esta comunidad' });

    const { data: community, error: commErr } = await supabase
      .from('communities')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    if (membership.role === 'admin' || community.creator_id === userId) {
      const { count: adminCount } = await supabase
        .from('community_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('community_id', id)
        .eq('role', 'admin');

      if ((adminCount || 0) <= 1) {
        return res.status(400).json({ error: 'El ultimo administrador no puede salir de la comunidad' });
      }
    }

    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /communities/:id/leave error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al salir de la comunidad') });
  }
});

module.exports = router;
