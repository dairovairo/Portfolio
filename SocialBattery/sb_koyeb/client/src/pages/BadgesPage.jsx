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
          style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,148,158,0.12) 0%, transparent 60%)' }}
        />
      )}

      <div
        className={`text-4xl relative z-10 ${assignment ? '' : 'grayscale'}`}
        style={isMine ? { filter: 'drop-shadow(0 0 10px rgba(0,148,158,0.5))' } : {}}
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
            {isMine ? 'Tu identidad' : `@${holder?.username || 'usuario'}`}
          </div>
          <div className="text-[11px] text-surface-muted/75 leading-tight relative z-10">
            {assignment.reason}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600 font-mono relative z-10">Sin identidad</div>
      )}
    </div>
  );
}

function GroupSelector({ groups, selectedId, onSelect }) {
  if (!groups.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {groups.map(group => (
        <button
          key={group.id}
          onClick={() => onSelect(group.id)}
          className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-sm font-display font-semibold transition-all border ${
            selectedId === group.id
              ? 'bg-accent-primary/20 text-accent-glow border-accent-primary/30'
              : 'bg-surface-card text-surface-muted border-surface-border hover:text-surface-text'
          }`}
        >
          {group.name}
        </button>
      ))}
    </div>
  );
}

export default function BadgesPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [badges, setBadges] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [members, setMembers] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingBadges, setLoadingBadges] = useState(false);

  // Cargar grupos del usuario
  useEffect(() => {
    async function loadGroups() {
      try {
        const result = await api.get('/groups');
        const userGroups = result.groups || [];
        setGroups(userGroups);
        if (userGroups.length > 0) {
          setSelectedGroupId(userGroups[0].id);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingGroups(false);
      }
    }
    loadGroups();
  }, []);

  // Cargar insignias del grupo seleccionado
  useEffect(() => {
    if (!selectedGroupId) return;

    async function loadBadges() {
      setLoadingBadges(true);
      try {
        const result = await api.get(`/badges/group/${selectedGroupId}`);
        setBadges(result.badges || []);
        setAssignments(result.assignments || []);
        setMembers(result.members || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingBadges(false);
      }
    }
    loadBadges();
  }, [selectedGroupId]);

  const assignmentMap = assignments.reduce((acc, assignment) => {
    acc[assignment.badgeId] = assignment;
    return acc;
  }, {});

  const myAssignments = assignments.filter(assignment => assignment.userId === profile?.id);
  const assignedCount = assignments.length;
  const totalBadges = badges.length;
  const progress = totalBadges > 0 ? Math.round((assignedCount / totalBadges) * 100) : 0;
  const selectedGroup = groups.find(g => g.id === selectedGroupId);

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
            <h1 className="font-display font-bold text-surface-text">Insignias del grupo</h1>
          </div>
          {selectedGroupId && (
            <span className="text-xs font-mono text-accent-glow bg-accent-primary/15 border border-accent-primary/20 px-2.5 py-1 rounded-xl">
              {assignedCount}/{totalBadges}
            </span>
          )}
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Sin grupos */}
        {!loadingGroups && groups.length === 0 && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center">
            <div className="text-3xl mb-3">👥</div>
            <div className="font-display font-semibold text-surface-text mb-1.5">Necesitas un grupo privado</div>
            <div className="text-sm text-surface-muted leading-relaxed">
              Crea un grupo privado de amigos para que las insignias tengan sentido.
              Cada grupo tiene sus propias identidades.
            </div>
            <button
              onClick={() => navigate('/friends')}
              className="mt-4 bg-accent-primary/20 text-accent-glow border border-accent-primary/30 text-sm font-display font-semibold px-4 py-2 rounded-xl hover:bg-accent-primary/30 transition-all"
            >
              Ir a amigos →
            </button>
          </div>
        )}

        {/* Selector de grupo */}
        {groups.length > 0 && (
          <GroupSelector
            groups={groups}
            selectedId={selectedGroupId}
            onSelect={setSelectedGroupId}
          />
        )}

        {/* Info del grupo seleccionado */}
        {selectedGroupId && !loadingBadges && selectedGroup && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 border-accent-primary/40 flex-shrink-0"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(0,148,158,0.2) 0%, transparent 70%)',
                  boxShadow: '0 0 20px rgba(0,148,158,0.25)',
                }}
              >
                🏅
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-surface-text text-base mb-0.5">
                  {selectedGroup.name}
                </div>
                <div className="text-sm text-surface-muted">
                  {members.length} miembros · {myAssignments.length || 'ninguna'} identidad para ti
                </div>
              </div>
            </div>

            <div className="h-2 bg-surface-bg rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(to right, rgb(0, 148, 158), rgb(45, 212, 220))',
                  boxShadow: '0 0 8px rgba(0,148,158,0.4)',
                }}
              />
            </div>
            <p className="text-xs text-surface-muted mt-3 leading-relaxed">
              Cada identidad solo la puede tener una persona en el grupo.
              Cada persona puede tener como maximo 2. Si hay empate de puntuacion,
              tiene prioridad quien tenga menos identidades; si sigue empatado,
              se elige un titular estable al azar. Al ganarla queda en tu perfil para siempre.
            </p>
          </div>
        )}

        {/* Insignias */}
        {loadingGroups || (selectedGroupId && loadingBadges) ? (
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
        ) : selectedGroupId && badges.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-display font-bold text-surface-text text-base">Identidades actuales</h3>
                <p className="text-xs text-surface-muted">Dentro de {selectedGroup?.name}</p>
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
        ) : null}

        {/* Sin actividad en el grupo */}
        {selectedGroupId && !loadingBadges && badges.length > 0 && assignments.length === 0 && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 text-center">
            <div className="text-3xl mb-3">📊</div>
            <div className="font-display font-semibold text-surface-text mb-1.5">Sin datos aún</div>
            <div className="text-sm text-surface-muted leading-relaxed">
              Cread pools y registrad batería para que se puedan calcular las identidades del grupo.
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
