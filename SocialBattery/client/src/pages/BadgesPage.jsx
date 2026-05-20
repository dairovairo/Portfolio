import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

// ── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_META = {
  tiempo:  { label: '🕐 Horarios',       desc: 'Por cuándo estás activo' },
  bateria: { label: '🔋 Batería',         desc: 'Por el nivel de tu energía social' },
  habito:  { label: '📆 Hábitos',         desc: 'Por tu constancia' },
  social:  { label: '🤝 Social',          desc: 'Por tus conexiones y organización' },
  general: { label: '⭐ General',          desc: 'Logros generales' },
};

// ── Badge card ────────────────────────────────────────────────────────────────
function BadgeCard({ badge, earnedAt }) {
  const earned = !!earnedAt;

  return (
    <div
      className={`relative rounded-2xl border p-4 flex flex-col items-center text-center gap-2 transition-all duration-300 ${
        earned
          ? 'bg-surface-card border-accent-primary/40 shadow-lg shadow-accent-primary/10'
          : 'bg-surface-card/30 border-surface-border opacity-40'
      }`}
      title={badge.description}
    >
      {/* Earned glow */}
      {earned && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ background: 'radial-gradient(circle at 50% 0%, rgba(124,58,237,0.1) 0%, transparent 60%)' }}
        />
      )}

      {/* Emoji */}
      <div
        className={`text-4xl relative z-10 ${earned ? '' : 'grayscale'}`}
        style={earned ? { filter: 'drop-shadow(0 0 10px rgba(168,85,247,0.5))' } : {}}
      >
        {badge.emoji}
      </div>

      {/* Name */}
      <div className="font-display font-semibold text-surface-text text-sm leading-snug relative z-10">
        {badge.name}
      </div>

      {/* Description */}
      <div className="text-xs text-surface-muted leading-tight relative z-10">
        {badge.description}
      </div>

      {/* Earned date */}
      {earned && (
        <div className="text-xs font-mono text-accent-glow/70 relative z-10">
          {new Date(earnedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      )}

      {/* Lock icon for unearned */}
      {!earned && (
        <div className="text-xs text-slate-600 font-mono relative z-10">🔒 Sin desbloquear</div>
      )}
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────
function CategorySection({ category, badges, earnedMap }) {
  const meta = CATEGORY_META[category] || { label: category, desc: '' };
  const earnedInCategory = badges.filter(b => earnedMap[b.id]).length;

  return (
    <div>
      {/* Category header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display font-bold text-surface-text text-base">{meta.label}</h3>
          <p className="text-xs text-surface-muted">{meta.desc}</p>
        </div>
        <span className="text-xs font-mono text-surface-muted bg-surface-card border border-surface-border px-2 py-1 rounded-lg">
          {earnedInCategory}/{badges.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-border rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent-primary to-accent-glow rounded-full transition-all duration-500"
          style={{ width: `${badges.length > 0 ? (earnedInCategory / badges.length) * 100 : 0}%` }}
        />
      </div>

      {/* Badge grid */}
      <div className="grid grid-cols-2 gap-3">
        {badges.map(badge => (
          <BadgeCard
            key={badge.id}
            badge={badge}
            earnedAt={earnedMap[badge.id]}
          />
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BadgesPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [allBadges, setAllBadges] = useState([]);
  const [earnedMap, setEarnedMap] = useState({});   // badge_id → earned_at
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [{ badges: catalog }, { badges: earned }] = await Promise.all([
          api.get('/badges'),
          api.get('/badges/my'),
        ]);

        setAllBadges(catalog || []);

        const map = {};
        (earned || []).forEach(ub => {
          map[ub.badge.id] = ub.earned_at;
        });
        setEarnedMap(map);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Group by category (maintain stable order)
  const byCategory = allBadges.reduce((acc, badge) => {
    const cat = badge.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(badge);
    return acc;
  }, {});

  const categoryOrder = ['bateria', 'habito', 'social', 'tiempo', 'general'];
  const sortedCategories = [
    ...categoryOrder.filter(c => byCategory[c]),
    ...Object.keys(byCategory).filter(c => !categoryOrder.includes(c)),
  ];

  const totalEarned = Object.keys(earnedMap).length;
  const totalBadges = allBadges.length;
  const progress = totalBadges > 0 ? Math.round((totalEarned / totalBadges) * 100) : 0;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg"
          >
            ←
          </button>
          <div className="flex-1">
            <h1 className="font-display font-bold text-surface-text">Insignias</h1>
          </div>
          <span className="text-xs font-mono text-accent-glow bg-accent-primary/15 border border-accent-primary/20 px-2.5 py-1 rounded-xl">
            {totalEarned}/{totalBadges}
          </span>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-7">

        {/* Overall progress hero */}
        {!loading && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2 border-accent-primary/40 flex-shrink-0"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(124,58,237,0.2) 0%, transparent 70%)',
                  boxShadow: '0 0 25px rgba(124,58,237,0.3)',
                }}
              >
                🏅
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-surface-text text-xl mb-0.5">
                  {profile?.display_name || 'Tu colección'}
                </div>
                <div className="text-sm text-surface-muted">
                  {totalEarned === 0
                    ? 'Todavía no has ganado ninguna insignia'
                    : totalEarned === totalBadges
                    ? '🎊 ¡Colección completa!'
                    : `Has desbloqueado ${totalEarned} de ${totalBadges} insignias`}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2.5 bg-surface-bg rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: progress === 100
                    ? 'linear-gradient(to right, #22c55e, #84cc16)'
                    : 'linear-gradient(to right, #7c3aed, #a855f7)',
                  boxShadow: '0 0 10px rgba(168,85,247,0.4)',
                }}
              />
            </div>
            <div className="text-right text-xs font-mono text-surface-muted mt-1.5">{progress}%</div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-surface-card border border-surface-border rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-surface-border rounded w-1/3 mb-3" />
                <div className="grid grid-cols-2 gap-3">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="h-32 bg-surface-border rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Badge categories */}
        {!loading && sortedCategories.map(category => (
          <CategorySection
            key={category}
            category={category}
            badges={byCategory[category]}
            earnedMap={earnedMap}
          />
        ))}

        {/* Hint for new users */}
        {!loading && totalEarned === 0 && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center">
            <div className="text-3xl mb-3">🌱</div>
            <div className="font-display font-semibold text-surface-text mb-1.5">Empieza a ganar insignias</div>
            <div className="text-sm text-surface-muted leading-relaxed">
              Actualiza tu batería social cada día para desbloquear logros. ¡Algunos se consiguen la primera vez que lo haces!
            </div>
            <button
              onClick={() => navigate('/')}
              className="mt-4 bg-accent-primary/20 text-accent-glow border border-accent-primary/30 text-sm font-display font-semibold px-4 py-2 rounded-xl hover:bg-accent-primary/30 transition-all"
            >
              Actualizar batería →
            </button>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
