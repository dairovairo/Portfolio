import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';
// ── Activity emoji mapping ────────────────────────────────────────────────────
function getActivityEmoji(activity = '') {
  const a = activity.toLowerCase();
  if (/café|cafe|coffee|cafetera/.test(a)) return '☕';
  if (/cine|película|pelicula|movie/.test(a)) return '🎬';
  if (/cerveza|bar|birra|drink|copa/.test(a)) return '🍺';
  if (/comida|comer|restaurante|almuerzo|cena/.test(a)) return '🍽️';
  if (/parque|paseo|walk|caminar|jardín/.test(a)) return '🌳';
  if (/deporte|gym|fútbol|futbol|tenis|paddle|sport/.test(a)) return '⚽';
  if (/playa|piscina|pool|swim/.test(a)) return '🏊';
  if (/música|musica|concierto|concert/.test(a)) return '🎵';
  if (/juego|gaming|videojuego|partida/.test(a)) return '🎮';
  if (/estudio|estudiar|trabajo|trabajar|biblioteca/.test(a)) return '📚';
  if (/fiesta|party|celebrar/.test(a)) return '🎉';
  if (/yoga|meditación|meditacion/.test(a)) return '🧘';
  if (/senderismo|hiking|montaña|montana/.test(a)) return '🥾';
  if (/compras|shopping/.test(a)) return '🛍️';
  return '🤝';
}

// ── Date formatting ───────────────────────────────────────────────────────────
function formatPoolDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) return 'Ya pasó';
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / 60000);
    return `En ${mins} min`;
  }
  if (diffHours < 24) {
    return `Hoy a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) {
    return `Mañana a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatInputDateTime(dateStr) {
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    open:      { label: 'Abierto',    cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    full:      { label: 'Completo',   cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    closed:    { label: 'Cerrado',    cls: 'bg-slate-600/30 text-surface-muted border-slate-600/30' },
    cancelled: { label: 'Cancelado',  cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };
  const cfg = map[status] || map.open;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Pool capacity bar ─────────────────────────────────────────────────────────
function CapacityBar({ current, max }) {
  const pct = Math.min(100, (current / max) * 100);
  const color = pct >= 100 ? '#f97316' : pct >= 75 ? '#facc15' : '#4ade80';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}60` }}
        />
      </div>
      <span className="text-xs font-mono text-surface-muted flex-shrink-0">
        {current}/{max}
      </span>
    </div>
  );
}

// ── Pool Card ──────────────────────────────────────────────────────────────────
function PoolCard({ pool, onJoin, onLeave, onCancel, onDetail, joining, leaving }) {
  const emoji = getActivityEmoji(pool.activity);
  const canJoin = pool.status === 'open' && !pool.has_joined;
  const isPast = new Date(pool.scheduled_at) <= new Date();

  return (
    <div
      className={`bg-surface-card border rounded-2xl p-4 transition-all duration-200 ${
        pool.status === 'cancelled' ? 'border-red-500/20 opacity-60' :
        pool.has_joined ? 'border-accent-primary/30 shadow-sm shadow-accent-primary/10' :
        'border-surface-border hover:border-surface-border/80'
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="text-3xl flex-shrink-0 mt-0.5">{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-surface-text text-base leading-tight truncate">
              {pool.activity}
            </h3>
            <StatusBadge status={pool.status} />
            {pool.is_public && (
              <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full font-mono">
                Público
              </span>
            )}
            {pool.has_joined && !pool.is_creator && (
              <span className="text-xs bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-1.5 py-0.5 rounded-full font-mono">
                ✓ Unido
              </span>
            )}
            {pool.is_creator && (
              <span className="text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded-full font-mono">
                Tuyo
              </span>
            )}
          </div>

          {pool.description && (
            <p className="text-xs text-surface-muted mt-1 line-clamp-2">{pool.description}</p>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-surface-muted">
          <span>🕐</span>
          <span className="font-mono">{formatPoolDate(pool.scheduled_at)}</span>
        </div>
        {pool.location_hint && (
          <div className="flex items-center gap-2 text-xs text-surface-muted">
            <span>📍</span>
            <span className="truncate">{pool.location_hint}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-surface-muted">
          <span>👤</span>
          <span>
            {pool.creator?.display_name || pool.creator?.username}
            {pool.is_creator ? ' (tú)' : ''}
          </span>
        </div>
      </div>

      {/* Capacity */}
      <CapacityBar current={pool.participant_count} max={pool.max_people} />
      {pool.spots_left > 0 && pool.status === 'open' && (
        <p className="text-xs text-surface-muted mt-1 font-mono">
          {pool.spots_left} {pool.spots_left === 1 ? 'plaza libre' : 'plazas libres'}
        </p>
      )}

      {/* Actions */}
      {!isPast && pool.status !== 'cancelled' && pool.status !== 'closed' && (
        <div className="mt-3 flex gap-2">
          {canJoin ? (
            <button
              onClick={() => onJoin(pool.id)}
              disabled={joining === pool.id || pool.status === 'full'}
              className="flex-1 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-semibold transition-all disabled:opacity-50"
            >
              {joining === pool.id ? 'Uniéndose...' :
               pool.status === 'full' ? 'Completo' : '🚀 Unirse'}
            </button>
          ) : pool.has_joined && !pool.is_creator ? (
            <button
              onClick={() => onLeave(pool.id)}
              disabled={leaving === pool.id}
              className="flex-1 py-2 rounded-xl bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 text-sm font-display font-semibold border border-slate-600/30 hover:border-red-500/30 transition-all disabled:opacity-50"
            >
              {leaving === pool.id ? 'Saliendo...' : 'Salir del pool'}
            </button>
          ) : null}

          {pool.is_creator && (
            <button
              onClick={() => onCancel(pool.id)}
              className="py-2 px-3 rounded-xl bg-slate-700/50 hover:bg-red-500/20 text-surface-muted hover:text-red-400 text-sm border border-slate-600/30 hover:border-red-500/30 transition-all"
              title="Cancelar pool"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create Pool Modal ─────────────────────────────────────────────────────────
function CreatePoolModal({ onClose, onCreate }) {
  const minDate = formatInputDateTime(new Date(Date.now() + 30 * 60 * 1000));
  const [form, setForm] = useState({
    activity: '',
    description: '',
    location_hint: '',
    scheduled_at: minDate,
    max_people: 4,
    is_public: true,
    group_id: null,
  });
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const emoji = getActivityEmoji(form.activity);

  useEffect(() => {
    api.get('/groups').then(({ groups: data }) => setGroups(data || [])).catch(() => {});
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function setVisibility(isPublic) {
    setForm(f => ({ ...f, is_public: isPublic, group_id: null }));
  }

  async function handleSubmit() {
    if (!form.activity.trim()) { setError('La actividad es obligatoria'); return; }
    if (!form.scheduled_at) { setError('La fecha es obligatoria'); return; }
    if (!form.is_public && !form.group_id) { setError('Elige un grupo para el pool privado'); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        ...form,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        max_people: parseInt(form.max_people),
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el pool');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6 sm:hidden" />

        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{emoji}</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Crear pool</h2>
            <p className="text-xs text-surface-muted">Propón un plan, tus amigos se unirán</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Activity */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Actividad *</label>
            <input type="text" value={form.activity} onChange={e => set('activity', e.target.value)}
              placeholder="Ej: Café en el centro, Fútbol 5, Cine..." maxLength={100}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Descripción <span className="text-slate-600">(opcional)</span></label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Más detalles sobre el plan..." maxLength={300} rows={2}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none" />
          </div>

          {/* Date/time + max people */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Cuándo *</label>
              <input type="datetime-local" value={form.scheduled_at} min={minDate} onChange={e => set('scheduled_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Personas máx.</label>
              <input type="number" value={form.max_people} min={2} max={50} onChange={e => set('max_people', parseInt(e.target.value) || 2)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Ubicación <span className="text-slate-600">(opcional)</span></label>
            <input type="text" value={form.location_hint} onChange={e => set('location_hint', e.target.value)}
              placeholder="Ej: Plaza Mayor, cerca de la estación..." maxLength={150}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
          </div>

          {/* Visibility: Public / Private */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-2">Visibilidad</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setVisibility(true)}
                className={`p-3 rounded-xl border text-left transition-all ${form.is_public ? 'border-accent-primary bg-accent-primary/10' : 'border-surface-border bg-surface-bg hover:border-surface-border/60'}`}>
                <div className="text-lg mb-1">🌐</div>
                <div className="text-sm font-display font-semibold text-surface-text">Público</div>
                <div className="text-xs text-surface-muted mt-0.5">Visible para todos tus amigos</div>
              </button>
              <button type="button" onClick={() => setVisibility(false)}
                className={`p-3 rounded-xl border text-left transition-all ${!form.is_public ? 'border-purple-500/50 bg-purple-500/10' : 'border-surface-border bg-surface-bg hover:border-surface-border/60'}`}>
                <div className="text-lg mb-1">🔒</div>
                <div className="text-sm font-display font-semibold text-surface-text">Privado</div>
                <div className="text-xs text-surface-muted mt-0.5">Solo para un grupo</div>
              </button>
            </div>
          </div>

          {/* Group selector (only when private) */}
          {!form.is_public && (
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-2">Elige el grupo *</label>
              {groups.length === 0 ? (
                <div className="bg-surface-bg border border-surface-border rounded-xl p-4 text-center">
                  <p className="text-surface-muted text-sm">No tienes grupos creados aún</p>
                  <p className="text-xs text-slate-600 mt-1">Ve a Amigos → Grupos → Crear grupo</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {groups.map(g => (
                    <button key={g.id} type="button" onClick={() => set('group_id', g.id)}
                      className={`w-full p-3 rounded-xl border flex items-center gap-3 transition-all text-left ${
                        form.group_id === g.id ? 'border-purple-500/50 bg-purple-500/10' : 'border-surface-border bg-surface-bg hover:border-surface-border/60'
                      }`}>
                      <span className="text-xl">👥</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-display font-semibold text-surface-text truncate">{g.name}</div>
                        <div className="text-xs text-surface-muted">{g.member_count} miembros</div>
                      </div>
                      {form.group_id === g.id && <span className="text-purple-400 text-sm">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

          <button onClick={handleSubmit} disabled={saving || !form.activity.trim()}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text font-display font-bold text-sm transition-all disabled:opacity-50">
            {saving ? 'Creando...' : '🚀 Crear pool'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PoolsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active'); // active | mine | joined
  const [showCreate, setShowCreate] = useState(false);
  const [joining, setJoining] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const fetchPools = useCallback(async (filter = tab) => {
    setLoading(true);
    try {
      const { pools: data } = await api.get(`/pools?filter=${filter}&limit=30`);
      setPools(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchPools(tab);
  }, [tab, fetchPools]);

  // Realtime: refresh when pools change
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('pools-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hangout_pools' },
        () => fetchPools(tab))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pool_participants' },
        () => fetchPools(tab))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, tab, fetchPools]);

  async function handleCreate(formData) {
    const { pool } = await api.post('/pools', formData);
    showToast('¡Pool creado! 🎉');
    setTab('mine');
    fetchPools('mine');
  }

  async function handleJoin(poolId) {
    setJoining(poolId);
    try {
      await api.post(`/pools/${poolId}/join`, {});
      showToast('¡Te has unido! 🚀');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'No se pudo unir', 'error');
    } finally {
      setJoining(null);
    }
  }

  async function handleLeave(poolId) {
    setLeaving(poolId);
    try {
      const { cancelled } = await api.delete(`/pools/${poolId}/leave`);
      showToast(cancelled ? 'Pool cancelado' : 'Has salido del pool');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'Error al salir', 'error');
    } finally {
      setLeaving(null);
    }
  }

  async function handleCancel(poolId) {
    if (!confirm('¿Cancelar este pool? Los participantes serán notificados.')) return;
    try {
      await api.delete(`/pools/${poolId}`);
      showToast('Pool cancelado');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'Error al cancelar', 'error');
    }
  }

  const activePools = pools.filter(p => p.status !== 'cancelled' && p.status !== 'closed');
  const pastPools = pools.filter(p => p.status === 'cancelled' || p.status === 'closed');

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1">Pool de Quedadas</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-semibold px-4 py-1.5 rounded-xl transition-all"
          >
            + Crear
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1 mb-5">
          {[
            { key: 'active', label: '🌐 Activos' },
            { key: 'joined', label: '✓ Mis planes' },
            { key: 'mine', label: '📅 Mis pools' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 text-xs font-display font-semibold py-2 rounded-lg transition-all ${
                tab === key
                  ? 'bg-accent-primary text-surface-text shadow-sm'
                  : 'text-slate-400 hover:text-surface-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-lg mx-auto px-4 pb-10">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-44 bg-surface-card rounded-2xl animate-pulse border border-surface-border" />
            ))}
          </div>
        ) : pools.length === 0 ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
            <div className="text-5xl mb-4">
              {tab === 'active' ? '🤝' : tab === 'mine' ? '📅' : '🚀'}
            </div>
            <p className="text-slate-300 font-display font-semibold mb-1">
              {tab === 'active' ? 'Sin pools activos' :
               tab === 'mine' ? 'Aún no has creado pools' :
               'No estás en ningún plan'}
            </p>
            <p className="text-slate-500 text-sm mb-5">
              {tab === 'active'
                ? 'Crea un pool o espera a que tus amigos propongan planes'
                : tab === 'mine'
                ? '¡Propón un plan y que se unan tus amigos!'
                : 'Únete a pools activos de tus amigos'}
            </p>
            <button
              onClick={() => tab === 'active' || tab === 'mine' ? setShowCreate(true) : setTab('active')}
              className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-5 py-2.5 rounded-xl text-sm font-display font-semibold"
            >
              {tab === 'joined' ? '🔍 Ver pools activos' : '+ Crear pool'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Active pools */}
            {activePools.map(pool => (
              <PoolCard
                key={pool.id}
                pool={pool}
                onJoin={handleJoin}
                onLeave={handleLeave}
                onCancel={handleCancel}
                joining={joining}
                leaving={leaving}
              />
            ))}

            {/* Past pools (collapsed) */}
            {pastPools.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-mono text-slate-600 mb-2 px-1">
                  Cancelados / cerrados ({pastPools.length})
                </p>
                <div className="space-y-2">
                  {pastPools.map(pool => (
                    <PoolCard
                      key={pool.id}
                      pool={pool}
                      onJoin={handleJoin}
                      onLeave={handleLeave}
                      onCancel={handleCancel}
                      joining={joining}
                      leaving={leaving}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Create Pool Modal */}
      {showCreate && (
        <CreatePoolModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display font-semibold text-sm shadow-xl transition-all ${
            toast.type === 'error'
              ? 'bg-red-500/90 text-surface-text border border-red-400/30'
              : 'bg-green-500/90 text-surface-text border border-green-400/30'
          }`}
        >
          {toast.msg}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
