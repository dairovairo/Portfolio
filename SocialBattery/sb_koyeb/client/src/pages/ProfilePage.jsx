import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { usePush } from '../hooks/usePush';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { BatteryLineChart, BatteryHeatmap } from '../components/BatteryChart';
import BatterySlider from '../components/BatterySlider';
import BadgeUnlockModal from '../components/BadgeUnlockModal';
import BottomNav from '../components/BottomNav';

// ── Public Stats ──────────────────────────────────────────────────────────────
function formatMemberSince(isoDate) {
  if (!isoDate) return '—';
  const start = new Date(isoDate);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 1)  return 'Hoy';
  if (diffDays < 30) return `${diffDays} día${diffDays !== 1 ? 's' : ''}`;
  const months = Math.floor(diffDays / 30);
  if (months < 12)   return `${months} mes${months !== 1 ? 'es' : ''}`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}a ${remMonths}m` : `${years} año${years !== 1 ? 's' : ''}`;
}

function StatsGrid({ stats }) {
  if (!stats) return null;
  const items = [
    { icon: '👥', label: 'Amigos',           value: stats.friends_count },
    { icon: '🗓️', label: 'Planes creados',   value: stats.pools_created },
    { icon: '🚀', label: 'Planes unidos',    value: stats.pools_joined },
    { icon: '🔋', label: 'Updates batería',  value: stats.battery_updates },
    { icon: '⏱️', label: 'Tiempo en la app', value: formatMemberSince(stats.member_since) },
  ];
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
      <h3 className="font-display font-semibold text-surface-text mb-3 text-sm">
        📊 Estadísticas públicas
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ icon, label, value }) => (
          <div
            key={label}
            className="bg-surface-bg rounded-xl px-3 py-3 flex items-center gap-3"
          >
            <span className="text-xl flex-shrink-0">{icon}</span>
            <div className="min-w-0">
              <div className="font-display font-bold text-surface-text text-base leading-none">
                {value ?? '—'}
              </div>
              <div className="text-xs text-surface-muted font-mono mt-0.5 leading-tight">
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BadgeCard({ badge, earned }) {
  const statusLabel = earned ? 'Desbloqueada' : 'Bloqueada';

  return (
    <div
      className={`relative rounded-2xl p-3 border text-center transition-all ${
        earned
          ? 'bg-surface-card border-accent-primary/30 shadow-sm shadow-accent-primary/10'
          : 'bg-surface-card/40 border-surface-border opacity-40'
      }`}
      title={`${badge.description || badge.name} · ${statusLabel}`}
    >
      <span
        className={`absolute top-2 right-2 sb-symbol text-sm ${
          earned ? 'text-accent-glow' : 'text-surface-muted'
        }`}
        aria-label={statusLabel}
        title={statusLabel}
      >
        {earned ? '🔓︎' : '🔒︎'}
      </span>
      <div className="text-2xl mb-1">{badge.emoji}</div>
      <div className="text-xs font-display font-semibold text-surface-text leading-tight">{badge.name}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { addToast } = useToast();
  const { permission, subscribed, requestPermission } = usePush();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [history, setHistory] = useState([]);
  const [allBadges, setAllBadges] = useState([]);
  const [earnedBadgesMap, setEarnedBadgesMap] = useState({});
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyView, setHistoryView] = useState('line');
  const [stats, setStats] = useState(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Avatar upload
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    api.get('/battery/history')
      .then(({ history }) => setHistory(history || []))
      .catch(console.error)
      .finally(() => setLoadingHistory(false));

    api.get('/badges')
      .then(({ badges }) => setAllBadges(badges || []))
      .catch(console.error);

    api.get('/badges/my')
      .then(({ badges }) => {
        const map = {};
        (badges || []).forEach(entry => { map[entry.badge.id] = entry; });
        setEarnedBadgesMap(map);
      })
      .catch(console.error);

    if (profile?.id) {
      api.get(`/users/${profile.id}/stats`)
        .then(({ stats: s }) => setStats(s))
        .catch(console.error);
    }
  }, []);

  async function saveProfile() {
    if (
      displayName.trim() === profile?.display_name &&
      bio.trim() === (profile?.bio || '')
    ) { setEditing(false); return; }

    setSavingProfile(true);
    try {
      await api.patch('/users/me', {
        display_name: displayName.trim(),
        bio: bio.trim() || null,
      });
      await refreshProfile();
      setEditing(false);
      addToast('Perfil actualizado ✓', 'success');
    } catch (e) {
      addToast('Error al guardar', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { addToast('Imagen máximo 2MB', 'warning'); return; }

    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      await api.postForm('/users/avatar', formData);
      await refreshProfile();
      addToast('Foto actualizada ✓', 'success');
    } catch (err) {
      addToast('Error al subir foto', 'error');
      setAvatarPreview(null);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handlePushToggle() {
    if (subscribed || permission === 'granted') {
      addToast('Notificaciones ya activadas', 'info');
      return;
    }
    const granted = await requestPermission();
    if (granted) addToast('Notificaciones activadas 🔔', 'success');
    else addToast('Permiso denegado', 'warning');
  }

  const color = getBatteryColor(profile?.battery_level ?? 50);

  const avatarSrc = avatarPreview || profile?.avatar_url;
  const avatarInitial = (profile?.display_name || profile?.username)?.[0]?.toUpperCase();

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text transition-colors p-1">
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1">Mi Perfil</h1>
          <button
            onClick={toggleTheme}
            className={`transition-colors text-lg p-1 ${
              theme === 'dark'
                ? 'text-surface-text hover:text-white'
                : 'text-slate-950 hover:text-surface-text'
            }`}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            <span className="sb-symbol text-xl" aria-hidden="true">
              {theme === 'dark' ? '☼' : '☾'}
            </span>
          </button>
          <button
            onClick={signOut}
            className="text-xs text-surface-muted hover:text-red-400 transition-colors font-mono"
          >
            Salir
          </button>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ── Profile header card ── */}
        <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
          {/* Banner */}
          <div
            className="h-20 w-full"
            style={{ background: `linear-gradient(135deg, ${color.hex}30 0%, var(--sb-accent)20 100%)` }}
          />

          <div className="px-5 pb-5 -mt-10">
            {/* Avatar + edit avatar */}
            <div className="flex items-end justify-between mb-3">
              <div className="relative">
                <div
                  className="w-20 h-20 rounded-2xl border-4 flex items-center justify-center text-2xl font-display font-bold overflow-hidden"
                  style={{ borderColor: 'var(--sb-card)', background: `${color.hex}20` }}
                >
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span style={{ color: color.hex }}>{avatarInitial}</span>
                  )}
                  {uploadingAvatar && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-2xl">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1.5 -right-1.5 bg-accent-primary text-white w-7 h-7
                    rounded-full flex items-center justify-center text-xs border-2 border-surface-card
                    hover:bg-accent-primary/80 transition-all"
                >
                  📷
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>

              {/* Edit button */}
              {!editing && (
                <button
                  onClick={() => { setDisplayName(profile?.display_name || ''); setBio(profile?.bio || ''); setEditing(true); }}
                  className="bg-surface-hover border border-surface-border rounded-xl px-3 py-1.5
                    text-xs font-display font-semibold text-surface-text hover:text-accent-glow transition-all flex items-center gap-1.5"
                >
                  <span className="sb-symbol text-sm" aria-hidden="true">✎</span>
                  Editar
                </button>
              )}
            </div>

            {/* Name / bio area */}
            {editing ? (
              <div className="space-y-3 animate-slide-down">
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-1 uppercase tracking-widest">Nombre</label>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    maxLength={16}
                    onKeyDown={e => { if (e.key === 'Enter') saveProfile(); if (e.key === 'Escape') setEditing(false); }}
                    className="w-full bg-surface-bg border border-accent-primary rounded-xl px-3 py-2
                      text-surface-text text-sm focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-1 uppercase tracking-widest">Bio</label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    maxLength={160}
                    rows={2}
                    placeholder="Cuéntanos algo sobre ti..."
                    className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2
                      text-surface-text text-sm focus:outline-none focus:border-accent-primary
                      transition-colors resize-none"
                  />
                  <p className="text-right text-xs text-surface-muted/60">{bio.length}/160</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="flex-1 bg-accent-primary text-white text-xs px-3 py-2 rounded-xl font-display font-semibold"
                  >
                    {savingProfile ? '...' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 border border-surface-border text-surface-muted text-xs px-3 py-2 rounded-xl"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="font-display font-bold text-surface-text text-xl leading-tight">
                  {profile?.display_name}
                </h2>
                <div className="text-sm text-surface-muted font-mono">@{profile?.username}</div>
                {profile?.bio && (
                  <p className="text-sm text-surface-muted mt-2 leading-relaxed">{profile.bio}</p>
                )}
                <div className="text-xs text-surface-muted/60 mt-2">
                  Miembro desde {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
                    : '—'}
                </div>
              </>
            )}

            {/* Battery */}
            {!editing && (
              <div className="mt-4 pt-4 border-t border-surface-border flex items-center gap-4">
                <div>
                  <div className="text-xs text-surface-muted font-mono uppercase tracking-widest mb-0.5">
                    Batería
                    {profile?.battery_is_estimated && (
                      <span className="ml-2 text-yellow-400">⚡ estimada</span>
                    )}
                  </div>
                  <div className="flex items-end gap-1.5">
                    <span
                      className="font-display text-3xl font-bold"
                      style={{ color: color.hex, textShadow: `0 0 20px ${color.hex}40` }}
                    >
                      {profile?.battery_level ?? '—'}
                    </span>
                    <span className="text-surface-muted text-sm mb-0.5">%</span>
                    <span className="text-xs font-mono mb-0.5" style={{ color: color.hex }}>{color.label}</span>
                  </div>
                  <div className="text-xs text-surface-muted/60 mt-0.5">
                    {formatRelativeTime(profile?.battery_updated_at)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Badges ── */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-surface-text">Insignias</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-muted font-mono">
                {Object.keys(earnedBadgesMap).length}/{allBadges.length}
              </span>
              <button
                onClick={() => navigate('/badges')}
                className="text-xs text-accent-glow hover:text-accent-primary transition-colors font-mono"
              >
                Ver todas →
              </button>
            </div>
          </div>

          {allBadges.length > 0 && (
            <div className="h-1 bg-surface-bg rounded-full mb-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-primary to-accent-glow transition-all duration-500"
                style={{ width: `${Math.round((Object.keys(earnedBadgesMap).length / allBadges.length) * 100)}%` }}
              />
            </div>
          )}

          {allBadges.length === 0 ? (
            <div className="text-center text-surface-muted text-sm py-4">Cargando insignias...</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {[
                ...allBadges.filter(b => earnedBadgesMap[b.id]),
                ...allBadges.filter(b => !earnedBadgesMap[b.id]),
              ].slice(0, 8).map(badge => (
                <BadgeCard key={badge.id} badge={badge} earned={earnedBadgesMap[badge.id]} />
              ))}
            </div>
          )}

          {allBadges.length > 8 && (
            <button
              onClick={() => navigate('/badges')}
              className="mt-3 w-full text-xs text-surface-muted hover:text-surface-text text-center py-2
                rounded-xl hover:bg-surface-border transition-all"
            >
              +{allBadges.length - 8} insignias más →
            </button>
          )}
        </div>

        {/* ── Public Stats ── */}
        <StatsGrid stats={stats} />

        {/* ── Battery history ── */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-surface-text">Historial de batería</h3>
            <div className="flex gap-1">
              {[{ id: 'line', label: '📈' }, { id: 'heatmap', label: '🗓️' }].map(v => (
                <button
                  key={v.id}
                  onClick={() => setHistoryView(v.id)}
                  className={`px-2.5 py-1 rounded-lg text-sm transition-all ${
                    historyView === v.id ? 'bg-accent-primary/20 text-accent-glow' : 'text-surface-muted hover:text-surface-text'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {loadingHistory ? (
            <div className="h-28 skeleton" />
          ) : historyView === 'line' ? (
            <BatteryLineChart history={history} />
          ) : (
            <BatteryHeatmap history={history} />
          )}
          {history.length > 0 && (
            <p className="text-xs text-surface-muted/60 text-center mt-3 font-mono">
              {history.length} registros totales
            </p>
          )}
        </div>

        {/* ── Settings ── */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
          <h3 className="font-display font-semibold text-surface-text text-sm mb-1">Ajustes</h3>

          {/* Theme toggle */}
          <div className="flex items-center justify-between py-2 border-b border-surface-border">
            <div>
              <div className="text-sm font-display font-medium text-surface-text">
                <span className="sb-symbol mr-1" aria-hidden="true">
                  {theme === 'dark' ? '☾' : '☼'}
                </span>
                {theme === 'dark' ? 'Modo oscuro' : 'Modo claro'}
              </div>
              <div className="text-xs text-surface-muted">Apariencia de la app</div>
            </div>
            <button
              onClick={toggleTheme}
              className={`relative w-12 h-6 rounded-full transition-all duration-300 ${
                theme === 'light' ? 'bg-accent-primary' : 'bg-surface-border'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300 ${
                theme === 'light' ? 'left-7' : 'left-1'
              }`} />
            </button>
          </div>

          {/* Push notifications */}
          {('Notification' in window) && (
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-display font-medium text-surface-text">🔔 Notificaciones push</div>
                <div className="text-xs text-surface-muted">
                  {permission === 'granted'
                    ? subscribed ? 'Activadas' : 'Concedidas'
                    : permission === 'denied' ? 'Bloqueadas en el navegador'
                    : 'Recibe avisos cuando quieran quedar'}
                </div>
              </div>
              {permission !== 'denied' && (
                <button
                  onClick={handlePushToggle}
                  disabled={subscribed}
                  className={`px-3 py-1.5 rounded-xl text-xs font-display font-semibold transition-all ${
                    subscribed
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                      : 'bg-accent-primary/15 text-accent-glow border border-accent-primary/30 hover:bg-accent-primary/25'
                  }`}
                >
                  {subscribed ? '✓ Activas' : 'Activar'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Danger zone ── */}
        <div className="bg-surface-card border border-red-500/10 rounded-2xl p-4">
          <h3 className="font-display font-semibold text-red-400/70 text-sm mb-3">Zona peligrosa</h3>
          <button
            onClick={signOut}
            className="w-full bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-red-500/20 transition-all"
          >
            Cerrar sesión
          </button>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
