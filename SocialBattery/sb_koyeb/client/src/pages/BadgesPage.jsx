import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

function BadgeCard({ badge, assignment, currentUserId }) {
  const holder = assignment?.user;
  const isMine = assignment?.userId === currentUserId;

  return (
    <div
      className={`relative rounded-2xl border p-4 flex flex-col items-center text-center gap-2 transition-all duration-300 ${
        isMine
          ? 'bg-surface-card border-accent-primary/40 shadow-lg shadow-accent-primary/10'
          : assignment
          ? 'bg-surface-card border-surface-border'
          : 'bg-surface-card/30 border-surface-border opacity-45'
      }`}
      title={badge.description}
    >
      {isMine && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ background: 'radial-gradient(circle at 50% 0%, rgba(124,58,237,0.12) 0%, transparent 60%)' }}
        />
      )}

      <div
        className={`text-4xl relative z-10 ${assignment ? '' : 'grayscale'}`}
        style={isMine ? { filter: 'drop-shadow(0 0 10px rgba(168,85,247,0.5))' } : {}}
      >
        {badge.emoji}
      </div>

      <div className="font-display font-semibold text-surface-text text-sm leading-snug relative z-10">
        {badge.name}
      </div>

      <div className="text-xs text-surface-muted leading-tight relative z-10">
        {badge.description}
      </div>

      {assignment ? (
        <>
          <div className={`text-xs font-mono relative z-10 ${isMine ? 'text-accent-glow/80' : 'text-surface-muted'}`}>
            {isMine ? 'Tu titulo' : `@${holder?.username || 'usuario'}`}
          </div>
          <div className="text-[11px] text-surface-muted/75 leading-tight relative z-10">
            {assignment.reason}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600 font-mono relative z-10">Sin titular</div>
      )}
    </div>
  );
}

export default function BadgesPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [badges, setBadges] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.get('/badges/circle');
        setBadges(result.badges || []);
        setAssignments(result.assignments || []);
        setMembers(result.members || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const assignmentMap = assignments.reduce((acc, assignment) => {
    acc[assignment.badgeId] = assignment;
    return acc;
  }, {});

  const myAssignments = assignments.filter(assignment => assignment.userId === profile?.id);
  const assignedCount = assignments.length;
  const totalBadges = badges.length;
  const progress = totalBadges > 0 ? Math.round((assignedCount / totalBadges) * 100) : 0;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg"
          >
            ←
          </button>
          <div className="flex-1">
            <h1 className="font-display font-bold text-surface-text">Insignias del circulo</h1>
          </div>
          <span className="text-xs font-mono text-accent-glow bg-accent-primary/15 border border-accent-primary/20 px-2.5 py-1 rounded-xl">
            {assignedCount}/{totalBadges}
          </span>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-7">
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
                  Tu circulo de amistades
                </div>
                <div className="text-sm text-surface-muted">
                  {members.length} miembros · {myAssignments.length || 'ningun'} titulo para ti
                </div>
              </div>
            </div>

            <div className="h-2.5 bg-surface-bg rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(to right, #7c3aed, #a855f7)',
                  boxShadow: '0 0 10px rgba(168,85,247,0.4)',
                }}
              />
            </div>
            <p className="text-xs text-surface-muted mt-3 leading-relaxed">
              Los titulos se recalculan dentro de tu circulo. Si alguien domina varias categorias,
              conserva la que gana con mas diferencia y deja sitio a otros cuando tambien destacan.
            </p>
          </div>
        )}

        {loading ? (
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
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-display font-bold text-surface-text text-base">Titulos activos</h3>
                <p className="text-xs text-surface-muted">Comparados contra tus amigos aceptados</p>
              </div>
              <span className="text-xs font-mono text-surface-muted bg-surface-card border border-surface-border px-2 py-1 rounded-lg">
                {assignedCount}/{totalBadges}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {badges.map(badge => (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  assignment={assignmentMap[badge.id]}
                  currentUserId={profile?.id}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && members.length <= 1 && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center">
            <div className="text-3xl mb-3">👥</div>
            <div className="font-display font-semibold text-surface-text mb-1.5">Necesitas un circulo</div>
            <div className="text-sm text-surface-muted leading-relaxed">
              Anade amigos y cread pools para que las insignias tengan sentido.
            </div>
            <button
              onClick={() => navigate('/friends')}
              className="mt-4 bg-accent-primary/20 text-accent-glow border border-accent-primary/30 text-sm font-display font-semibold px-4 py-2 rounded-xl hover:bg-accent-primary/30 transition-all"
            >
              Ir a amigos →
            </button>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
