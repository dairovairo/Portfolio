import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { getBatteryColor } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline } from '../hooks/usePresence';
import MascotDisplay from '../components/MascotDisplay';
import PhotoSourceMenu from '../components/PhotoSourceMenu';

// ── Mark group as read in localStorage ───────────────────────────────────────
function markGroupRead(groupId) {
  localStorage.setItem(`grp_read_${groupId}`, new Date().toISOString());
}

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// HomePage.jsx / FriendCard.jsx): 0-33 → low, 34-66 → mid, 67-100 → high.
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// Mascota en miniatura — misma lógica que FriendCard: capa base según tier
// de batería + overlay "horneado" (mascot_preview_url) con la personalización
// del usuario (ropa/calzado/gorro/accesorios), si la tiene.
function MiniMascot({ user, size = 32 }) {
  const color = getBatteryColor(user?.battery_level ?? 50);
  const tier = getMascotTier(user?.battery_level ?? 50);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <MascotDisplay
        tier={tier}
        size={size}
        glowColor={color.hex}
        outfitSrc={null}
        feetSrc={null}
        headSrc={null}
        accessories={[]}
        activityLayers={[]}
      />
      {user?.mascot_preview_url && (
        <img
          src={user.mascot_preview_url}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
        />
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

// ── Reply preview helpers — mismo patrón que en MessagesPage.jsx / PoolChatPage.jsx
function replyPreviewText(replyTo) {
  if (!replyTo) return '';
  if (replyTo.deleted_for_everyone) return '🚫 Mensaje eliminado';
  if (replyTo.type === 'image') return '📷 Imagen';
  if (replyTo.type === 'poll') return `📊 ${replyTo.content}`;
  return replyTo.content;
}

// ── ReplyQuote — cita renderizada dentro de una burbuja de mensaje ────────────
function ReplyQuote({ replyTo, currentUserId, onClick }) {
  if (!replyTo) return null;
  const label = replyTo.sender_id === currentUserId ? 'Tú' : (replyTo.sender?.username || 'Alguien');
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick?.(replyTo.id); }}
      className="w-full text-left flex flex-col gap-0.5 mb-1.5 px-2.5 py-1.5 rounded-lg bg-black/20 border-l-2 border-accent-primary/70 hover:bg-black/30 transition-colors active:scale-[0.99]"
    >
      <span className="text-[11px] font-display font-bold text-accent-glow leading-tight truncate">
        {label}
      </span>
      <span className="text-xs opacity-80 leading-tight truncate">
        {replyPreviewText(replyTo)}
      </span>
    </button>
  );
}

// ── ReplyComposerPreview — barra sobre el input mientras se redacta la respuesta
function ReplyComposerPreview({ replyingTo, label, onCancel }) {
  return (
    <div className="flex items-center gap-2 bg-surface-card border border-surface-border rounded-xl px-3 py-2 mb-2 animate-slide-up">
      <div className="w-1 self-stretch rounded-full bg-accent-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-display font-bold text-accent-glow truncate">
          Respondiendo a {label}
        </div>
        <div className="text-xs text-surface-muted truncate">
          {replyPreviewText(replyingTo)}
        </div>
      </div>
      <button
        onClick={onCancel}
        className="flex-shrink-0 w-7 h-7 rounded-full text-surface-muted hover:text-surface-text hover:bg-surface-hover flex items-center justify-center text-lg leading-none transition-colors"
        title="Cancelar respuesta"
      >
        ×
      </button>
    </div>
  );
}

function Avatar({ user, size = 'sm' }) {
  const color = getBatteryColor(user?.battery_level ?? 50);
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-11 h-11 text-sm';
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0`}
      style={{ borderColor: color.hex, background: `${color.hex}15` }}
    >
      {user?.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        : user?.username?.[0]?.toUpperCase() || '?'
      }
    </div>
  );
}

// Cuadrito de texto con nombre + descripción de la insignia.
// `align` controla si se pega al borde izquierdo o derecho del icono
// para no salirse de la pantalla según de qué lado esté la insignia.
// `placement` controla si se abre hacia arriba ('top', por defecto) o hacia
// abajo ('bottom') del icono — necesario para el primer usuario de una lista
// con scroll, donde abrir hacia arriba lo corta contra el borde superior.
function BadgeDescriptionPopover({ badge, align = 'left', placement = 'top' }) {
  return (
    <div
      className={`absolute z-50 ${placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} ${align === 'right' ? 'right-0' : 'left-0'} w-52 max-w-[70vw] bg-surface-card border border-surface-border rounded-xl p-3 shadow-2xl text-left animate-fade-in`}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg leading-none">{badge.emoji}</span>
        <span className="font-display font-bold text-surface-text text-sm">{badge.name}</span>
      </div>
      <p className="text-xs text-surface-muted leading-relaxed">{badge.description}</p>
    </div>
  );
}

// Insignia pulsable: al tocarla muestra su descripción en un cuadrito
// de texto (en vez de depender del "title" nativo, que no funciona bien
// en móvil). `size` = 'tile' (icono cuadrado grande), 'inline' (emoji
// pequeño junto a los mensajes), 'chip' (mini insignia junto al nombre
// de usuario) o 'panel' (insignia junto al nombre con su nombre debajo,
// usada en el panel de integrantes del grupo).
function IdentityBadge({ identity, size = 'tile', align = 'left', showName = false, popoverPlacement = 'top' }) {
  const [open, setOpen] = useState(false);

  const buttonClass = {
    tile: 'w-11 h-11 rounded-xl bg-accent-primary/10 border border-accent-primary/25 flex items-center justify-center text-2xl',
    inline: 'block leading-none text-lg mb-1.5 bg-transparent border-0 p-0',
    chip: 'w-5 h-5 rounded-md bg-accent-primary/10 border border-accent-primary/25 flex items-center justify-center text-xs leading-none flex-shrink-0',
    // +10% sobre el tamaño base (w-9 h-9 / text-xl) del panel de integrantes.
    panel: 'w-[2.475rem] h-[2.475rem] rounded-xl bg-accent-primary/10 border border-accent-primary/25 flex items-center justify-center text-[1.375rem]',
  }[size];

  const wrapperClass = size === 'panel'
    ? 'relative flex-shrink-0 flex flex-col items-center gap-0.5'
    : 'relative flex-shrink-0 inline-block';

  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={buttonClass}
      >
        {identity.badge.emoji}
      </button>
      {showName && (
        <span className="text-[9px] text-accent-glow font-display font-semibold text-center leading-tight max-w-[56px] truncate">
          {identity.badge.name}
        </span>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <BadgeDescriptionPopover badge={identity.badge} align={align} placement={popoverPlacement} />
        </>
      )}
    </div>
  );
}

// ── Add Member Modal ──────────────────────────────────────────────────────────

function AddMemberModal({ group, onClose, onAdded }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [search, setSearch] = useState('');

  const memberIds = new Set((group?.members || []).map(m => m.id));

  useEffect(() => {
    async function load() {
      try {
        const { friends: data } = await api.get('/friends');
        setFriends(data || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const eligible = friends.filter(f =>
    !memberIds.has(f.id) &&
    f.username?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd(friend) {
    setAdding(friend.id);
    try {
      await api.post(`/groups/${group.id}/members`, { user_id: friend.id });
      onAdded(friend);
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-display font-bold text-surface-text">Añadir miembro</div>
            <div className="text-xs text-surface-muted font-mono">{group.name}</div>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <input
          type="text"
          placeholder="Buscar amigos..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-shrink-0 w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-14 bg-surface-bg rounded-2xl animate-pulse" />)
          ) : eligible.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8">
              {friends.filter(f => !memberIds.has(f.id)).length === 0
                ? 'Todos tus amigos ya están en el grupo'
                : 'No se encontraron amigos'}
            </div>
          ) : (
            eligible.map(friend => {
              const color = getBatteryColor(friend.battery_level ?? 50);
              const isAdding = adding === friend.id;
              return (
                <div key={friend.id} className="bg-surface-bg border border-surface-border rounded-2xl p-3 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0 text-sm"
                    style={{ borderColor: color.hex, background: `${color.hex}15` }}
                  >
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                      : friend.username?.[0]?.toUpperCase()
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-surface-text text-sm truncate">{friend.username}</div>
                    <div className="text-xs text-surface-muted font-mono">🔋 {friend.battery_level ?? '—'}%</div>
                  </div>
                  <button
                    onClick={() => handleAdd(friend)}
                    disabled={isAdding}
                    className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-accent-primary/20 text-accent-glow border border-accent-primary/30 text-xs font-display font-semibold hover:bg-accent-primary/30 transition-colors disabled:opacity-50"
                  >
                    {isAdding ? '...' : '+ Añadir'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="font-display font-bold text-surface-text">{title}</div>
        <p className="text-sm text-surface-muted leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-surface-bg border border-surface-border text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Group info panel ──────────────────────────────────────────────────────────

function GroupInfoPanel({ group, assignments, loading, currentUserId, onOpenUser, onAddMember, onLeaveGroup, onDeleteGroup, onRemoveMember }) {
  const [confirmAction, setConfirmAction] = useState(null);

  const identitiesByUser = assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = [];
    acc[assignment.userId].push(assignment);
    return acc;
  }, {});

  const members = group?.members || [];
  const isOwner = group?.owner?.id === currentUserId;

  function handleConfirm() {
    if (!confirmAction) return;
    if (confirmAction.type === 'leave') onLeaveGroup();
    else if (confirmAction.type === 'delete') onDeleteGroup();
    else if (confirmAction.type === 'remove') onRemoveMember(confirmAction.memberId);
    setConfirmAction(null);
  }

  return (
    <>
      <div className="border-b border-surface-border bg-surface-bg/95 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-bold text-surface-text text-sm">Integrantes</div>
              <div className="text-xs text-surface-muted font-mono">
                {members.length} miembros · {assignments.length} identidades activas
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading && <span className="text-xs text-surface-muted font-mono animate-pulse">Calculando...</span>}
              {isOwner && (
                <button
                  onClick={onAddMember}
                  className="text-xs bg-accent-primary/15 text-accent-glow border border-accent-primary/25 px-3 py-1.5 rounded-xl font-display font-semibold hover:bg-accent-primary/25 transition-colors flex items-center gap-1"
                >
                  <span>+</span> Añadir
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {members.map((member, index) => {
              const memberIdentities = identitiesByUser[member.id] || [];
              const identity = memberIdentities[0] || null;
              const isOwnerMember = group?.owner?.id === member.id;
              const isMe = currentUserId === member.id;
              const color = getBatteryColor(member.battery_level ?? 50);
              const canRemove = isOwner && !isOwnerMember;
              const isFirst = index === 0;

              return (
                <div key={member.id} className="bg-surface-card border border-surface-border rounded-2xl p-3">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => onOpenUser(member.id)}
                      className="relative flex-shrink-0"
                    >
                      <Avatar user={member} size="md" />
                      {/* Mascota — izquierda-abajo del avatar (offset base de
                          -0.25rem + 6%/8%, igual que antes pero en espejo
                          hacia la izquierda). */}
                      <div className="absolute" style={{ bottom: 'calc(-0.25rem - 8%)', left: 'calc(-0.25rem - 6%)' }}>
                        <MiniMascot user={member} size={35} />
                      </div>
                      {/* Punto de en línea — derecha-abajo, mismo patrón que FriendCard.jsx */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-card ${isOnline(member.last_seen_at) ? 'bg-green-400' : 'bg-slate-600'}`}
                      />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div onClick={() => onOpenUser(member.id)} className="text-left w-full cursor-pointer">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="font-display font-semibold text-surface-text text-sm truncate">
                            {isMe ? 'Tú' : member.username}
                          </span>
                          {isOwnerMember && (
                            <span className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-md flex-shrink-0">
                              Admin
                            </span>
                          )}
                        </div>
                        {!identity && (
                          <div className="text-[11px] text-slate-600 font-mono mt-0.5">Sin identidad activa</div>
                        )}
                      </div>
                    </div>

                    {/* Insignia: a la izquierda del % de batería y de la
                        x de expulsión, centrada respecto a la altura total
                        del panel mediante self-center. */}
                    {identity && (
                      <div className="flex-shrink-0 self-center">
                        <IdentityBadge identity={identity} size="panel" showName align="right" popoverPlacement={isFirst ? 'bottom' : 'top'} />
                      </div>
                    )}

                    <div className="flex-shrink-0 flex flex-col items-center gap-1.5" style={{ width: 38 }}>
                      <div className="font-display font-bold tabular-nums text-sm" style={{ color: color.hex }}>
                        {member.battery_level ?? '—'}%
                      </div>
                      {member.battery_is_estimated && (
                        <div className="text-[11px] text-yellow-400 font-mono">estimada</div>
                      )}
                      {canRemove && (
                        <button
                          onClick={() => setConfirmAction({ type: 'remove', memberId: member.id, memberName: member.username })}
                          className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-bold leading-none"
                          aria-label="Expulsar"
                          title="Expulsar"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && assignments.length === 0 && (
            <div className="bg-surface-card/50 border border-surface-border rounded-2xl p-3 text-xs text-surface-muted leading-relaxed">
              Aun no hay identidades activas. Se calculan con la actividad del grupo y, al conseguir una, la insignia queda desbloqueada en el perfil para siempre.
            </div>
          )}

          {/* Danger zone */}
          <div className="pt-1 border-t border-surface-border/50">
            {isOwner ? (
              <button
                onClick={() => setConfirmAction({ type: 'delete' })}
                className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                🗑️ Eliminar grupo
              </button>
            ) : (
              <button
                onClick={() => setConfirmAction({ type: 'leave' })}
                className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                🚪 Salir del grupo
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={
            confirmAction.type === 'delete' ? 'Eliminar grupo' :
            confirmAction.type === 'leave'  ? 'Salir del grupo' :
            `Expulsar a ${confirmAction.memberName}`
          }
          message={
            confirmAction.type === 'delete'
              ? 'Se eliminará el grupo y todos sus mensajes permanentemente. Esta acción no se puede deshacer.'
              : confirmAction.type === 'leave'
              ? 'Dejarás de ser miembro de este grupo y perderás el acceso al chat.'
              : `${confirmAction.memberName} será expulsado del grupo y perderá el acceso al chat.`
          }
          confirmLabel={
            confirmAction.type === 'delete' ? 'Eliminar' :
            confirmAction.type === 'leave'  ? 'Salir' :
            'Expulsar'
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function DeletedBubble({ isMe, msgId }) {
  return (
    <div id={msgId ? `msg-${msgId}` : undefined} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[75%] rounded-2xl px-4 py-2.5 border border-surface-border bg-surface-card/50">
        <p className="text-sm italic text-surface-muted flex items-center gap-1.5">
          <span className="text-base">🚫</span>
          {isMe ? 'Eliminaste este mensaje' : 'Este mensaje ha sido eliminado'}
        </p>
      </div>
    </div>
  );
}

function LikeBadge({ liked, isMe }) {
  if (!liked) return null;
  return (
    <span
      className={`absolute -bottom-2 ${isMe ? '-left-2' : '-right-2'} w-5 h-5 rounded-full bg-surface-bg border border-surface-border flex items-center justify-center text-[11px] shadow-md z-10 leading-none animate-scale-in`}
      title="Le gusta este mensaje"
    >
      ❤️
    </span>
  );
}

function TextBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, identity, onLongPress, onQuoteClick, currentUserId }) {
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => onLongPress(msg), 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      {!isMe && <Avatar user={msg.sender} />}
      <div className="flex items-end gap-1.5 max-w-[75%]">
        <div className="min-w-0">
          {!isMe && (
            <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
              {msg.sender?.username}
            </div>
          )}
          <div
            className={`relative rounded-2xl px-4 py-2.5 select-none ${!isMe ? 'border border-surface-border' : ''}`}
            style={bubbleStyle}
          >
            <ReplyQuote replyTo={msg.reply_to} currentUserId={currentUserId} onClick={onQuoteClick} />
            <p className="text-sm leading-relaxed break-words" style={{ color: 'inherit' }}>{msg.content}</p>
            <div className="text-xs mt-1 opacity-60">
              <span>{new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <LikeBadge liked={msg.liked_by?.length > 0} isMe={isMe} />
          </div>
        </div>
        {identity && (
          <IdentityBadge identity={identity} size="inline" align={isMe ? 'right' : 'left'} />
        )}
      </div>
    </div>
  );
}

function ImageBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, identity, onLongPress, onQuoteClick, currentUserId }) {
  const [lightbox, setLightbox] = useState(false);
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  const isOptimistic = typeof msg.id === 'string' && msg.id.startsWith('opt-');
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => { if (!isOptimistic) onLongPress(msg); }, 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <>
      <div
        id={`msg-${msg.id}`}
        className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onContextMenu={e => { e.preventDefault(); if (!isOptimistic) onLongPress(msg); }}
      >
        {!isMe && <Avatar user={msg.sender} />}
        <div className="flex items-end gap-1.5 max-w-[75%]">
          <div className="min-w-0">
            {!isMe && (
              <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
                {msg.sender?.username}
              </div>
            )}
            <div
              className={`relative rounded-2xl overflow-hidden select-none ${!isMe ? 'border border-surface-border' : ''}`}
              style={bubbleStyle}
            >
              {msg.reply_to && (
                <div className="px-3 pt-2">
                  <ReplyQuote replyTo={msg.reply_to} currentUserId={currentUserId} onClick={onQuoteClick} />
                </div>
              )}
              <div className="relative">
                <img
                  src={msg.content}
                  alt="Imagen"
                  className="block w-full max-w-[260px] max-h-[340px] object-cover cursor-pointer"
                  onClick={() => { if (!isOptimistic) setLightbox(true); }}
                />
                {isOptimistic && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div className="text-xs px-3 pb-2 pt-1 opacity-60">
                <span>{new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <LikeBadge liked={msg.liked_by?.length > 0} isMe={isMe} />
            </div>
          </div>
          {identity && (
            <IdentityBadge identity={identity} size="inline" align={isMe ? 'right' : 'left'} />
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-bold z-10 w-10 h-10 flex items-center justify-center"
            onClick={() => setLightbox(false)}
          >
            ×
          </button>
          <img
            src={msg.content}
            alt="Imagen"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ── Poll bubble — mensaje de encuesta con votación en vivo ───────────────────
function PollBubble({ msg, isMe, identity, onVote, voting, onLongPress, onQuoteClick, currentUserId }) {
  const poll = msg.poll || {
    options: msg.poll_options || [],
    votes: (msg.poll_options || []).map(() => 0),
    totalVotes: 0,
    myVote: null,
  };
  const isVoting = voting === msg.id;
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => onLongPress(msg), 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      {!isMe && <Avatar user={msg.sender} />}
      <div className="flex items-end gap-1.5 max-w-[85%]">
        <div className="min-w-0 w-full">
          {!isMe && (
            <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
              {msg.sender?.username}
            </div>
          )}
          <div className="relative w-full min-w-[220px] bg-surface-card border border-surface-border rounded-2xl px-4 py-3">
            <ReplyQuote replyTo={msg.reply_to} currentUserId={currentUserId} onClick={onQuoteClick} />
            <p className="text-sm font-display font-semibold text-surface-text mb-2 flex items-center gap-1.5">
              📊 {msg.content}
            </p>
            <div className="space-y-1.5">
              {poll.options.map((opt, i) => {
                const count = poll.votes[i] || 0;
                const pct = poll.totalVotes ? Math.round((count / poll.totalVotes) * 100) : 0;
                const mine = poll.myVote === i;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isVoting}
                    onClick={() => onVote(msg.id, i, mine)}
                    className={`relative w-full text-left rounded-xl border overflow-hidden transition-all disabled:opacity-70 ${
                      mine ? 'border-accent-primary' : 'border-surface-border hover:border-accent-primary/40'
                    }`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-accent-primary/15 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                      <span className={`text-xs font-mono ${mine ? 'text-accent-glow font-semibold' : 'text-surface-text'}`}>
                        {mine ? '✓ ' : ''}{opt}
                      </span>
                      <span className="text-[10px] font-mono text-surface-muted flex-shrink-0">{pct}% · {count}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] font-mono text-surface-muted mt-2">
              <span>
                {poll.totalVotes} voto{poll.totalVotes === 1 ? '' : 's'} · {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                {poll.myVote != null ? ' · toca tu opción para quitar el voto' : ''}
              </span>
            </div>
            <LikeBadge liked={msg.liked_by?.length > 0} isMe={isMe} />
          </div>
        </div>
        {identity && (
          <IdentityBadge identity={identity} size="inline" align={isMe ? 'right' : 'left'} />
        )}
      </div>
    </div>
  );
}

// ── Create poll modal ─────────────────────────────────────────────────────────
function CreatePollModal({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateOption(i, value) {
    setOptions(prev => prev.map((o, idx) => (idx === i ? value : o)));
  }

  function addOption() {
    if (options.length >= 4) return;
    setOptions(prev => [...prev, '']);
  }

  function removeOption(i) {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (saving) return;
    setError('');
    const cleanQuestion = question.trim();
    const cleanOptions = options.map(o => o.trim()).filter(Boolean);
    if (!cleanQuestion) return setError('Escribe una pregunta');
    if (cleanOptions.length < 2) return setError('Añade al menos 2 opciones');
    if (new Set(cleanOptions.map(o => o.toLowerCase())).size !== cleanOptions.length) {
      return setError('Las opciones no pueden repetirse');
    }
    setSaving(true);
    try {
      await onCreate(cleanQuestion, cleanOptions);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear la encuesta');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Nueva encuesta</h2>
            <p className="text-xs text-surface-muted">El grupo votará en tiempo real</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <div>
          <label className="block text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-1">Pregunta</label>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="¿A qué hora quedamos?"
            maxLength={200}
            autoFocus
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-1">Opciones</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={e => updateOption(i, e.target.value)}
                  placeholder={`Opción ${i + 1}`}
                  maxLength={60}
                  className="flex-1 bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                    title="Quitar opción"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {options.length < 4 && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
            >
              + Añadir opción
            </button>
          )}
        </div>

        {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors border border-surface-border">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display font-semibold disabled:opacity-50 transition-all"
          >
            {saving ? 'Creando...' : '📊 Crear encuesta'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DateDivider({ date }) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const label = date === today ? 'Hoy'
    : date === yesterday ? 'Ayer'
    : new Date(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  return (
    <div className="text-center text-xs text-slate-600 font-mono py-3">
      <span className="bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full">{label}</span>
    </div>
  );
}

// ── Wallpaper modal ───────────────────────────────────────────────────────────

function WallpaperModal({ current, onSet, onClear, onClose }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      onSet(dataUrl);
      onClose();
    } catch {}
    finally { setLoading(false); e.target.value = ''; }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-bold text-surface-text">Fondo del grupo</div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        {current && (
          <div
            className="w-full h-24 rounded-2xl bg-cover bg-center border border-surface-border"
            style={{ backgroundImage: `url(${current})` }}
          />
        )}

        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-surface-border hover:border-accent-primary/50 hover:bg-accent-primary/5 transition-all text-sm text-surface-muted font-display font-semibold"
        >
          <span className="text-lg">🖼️</span>
          {loading ? 'Cargando...' : 'Elegir imagen de la galería'}
        </button>

        {current && (
          <button
            onClick={() => { onClear(); onClose(); }}
            className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Quitar fondo del grupo
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Pinned message banner ────────────────────────────────────────────────────
function PinnedBanner({ pinned, canUnpin, onUnpin, onJumpTo }) {
  if (!pinned) return null;
  const preview = pinned.type === 'image' ? '📷 Foto' : pinned.type === 'poll' ? `📊 ${pinned.content}` : pinned.content;
  return (
    <div
      className="sticky top-0 z-10 -mx-4 mb-2 px-4 py-2 bg-surface-card/95 backdrop-blur-xl border-b border-surface-border flex items-center gap-2 cursor-pointer"
      onClick={onJumpTo}
    >
      <span className="text-base flex-shrink-0">📌</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono text-surface-muted">
          Fijado por {pinned.pinned_by?.username || pinned.sender?.username || 'alguien'}
        </div>
        <div className="text-sm text-surface-text truncate">{preview}</div>
      </div>
      {canUnpin && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUnpin(); }}
          className="flex-shrink-0 text-surface-muted hover:text-surface-text text-lg leading-none px-1"
          title="Desfijar mensaje"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── MessageContextMenu — menú al mantener pulsado ─────────────────────────────
function MessageContextMenu({ msg, isMe, isLiked, isPinned, canPin, onClose, onReply, onToggleLike, onTogglePin, onDeleteForMe, onDeleteForEveryone }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card border border-surface-border rounded-t-3xl w-full max-w-lg pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-surface-border rounded-full mx-auto mt-3 mb-3" />

        {/* Preview */}
        {!msg.deleted_for_everyone && (
          <p className="text-xs text-surface-muted font-mono text-center truncate px-8 mb-3 opacity-60">
            {msg.type === 'image' ? '📷 Imagen' : msg.type === 'poll' ? `📊 ${msg.content}` : (msg.content?.slice(0, 80) + (msg.content?.length > 80 ? '…' : ''))}
          </p>
        )}

        <div className="px-4 pb-4 space-y-1.5">
          {!msg.deleted_for_everyone && (
            <button
              onClick={onToggleLike}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">❤️</span>
              <div>
                <div>{isLiked ? 'Quitar me gusta' : 'Me gusta'}</div>
                <div className="text-xs text-surface-muted font-normal">
                  {isLiked ? 'Deja de destacar este mensaje' : 'Destaca este mensaje con un corazón'}
                </div>
              </div>
            </button>
          )}

          {canPin && !msg.deleted_for_everyone && (
            <button
              onClick={onTogglePin}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">{isPinned ? '📌' : '📍'}</span>
              <div>
                <div>{isPinned ? 'Desfijar mensaje' : 'Fijar mensaje'}</div>
                <div className="text-xs text-surface-muted font-normal">
                  {isPinned ? 'Deja de destacarlo arriba del chat' : 'Lo destaca arriba del chat'}
                </div>
              </div>
            </button>
          )}

          {!msg.deleted_for_everyone && (
            <button
              onClick={onReply}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">↩️</span>
              <div>
                <div>Responder</div>
                <div className="text-xs text-surface-muted font-normal">Cita este mensaje en tu respuesta</div>
              </div>
            </button>
          )}

          {!msg.deleted_for_everyone && (
            <button
              onClick={onDeleteForMe}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">🗑️</span>
              <div>
                <div>Eliminar para mí</div>
                <div className="text-xs text-surface-muted font-normal">Solo desaparece de tu vista</div>
              </div>
            </button>
          )}

          {isMe && !msg.deleted_for_everyone && (
            <button
              onClick={onDeleteForEveryone}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500/15 text-red-400 text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">❌</span>
              <div>
                <div>Eliminar para todos</div>
                <div className="text-xs text-red-400/60 font-normal">Queda rastro en la conversación</div>
              </div>
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full text-center py-3.5 text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GroupChatPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { getGroupWallpaper, setGroupWallpaper, myBubbleStyle, otherBubbleStyle } = useSettings();

  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clearedAt, setClearedAt] = useState(null);
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const [badgeData, setBadgeData] = useState({ badges: [], assignments: [] });
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [loadingIdentities, setLoadingIdentities] = useState(true);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [toast, setToast] = useState(null);
  const [groupWallpaper, setGroupWallpaperState] = useState(() => getGroupWallpaper(groupId));
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);
  const photoCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [votingMessageId, setVotingMessageId] = useState(null);
  const headerMenuRef = useRef(null);
  const [replyingTo, setReplyingTo] = useState(null); // msg | null

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Cierra el menú de opciones (⋯) al hacer click fuera — mismo patrón que
  // en MessagesPage.jsx.
  useEffect(() => {
    function handleClick(e) {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowHeaderMenu(false);
      }
    }
    if (showHeaderMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showHeaderMenu]);


  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setShowGroupInfo(false);
        setLoadingIdentities(true);
        const [groupResult, messagesResult, badgesResult] = await Promise.all([
          api.get(`/groups/${groupId}`),
          api.get(`/groups/${groupId}/messages`),
          api.get(`/badges/group/${groupId}`).catch(error => {
            console.error(error);
            return { badges: [], assignments: [] };
          }),
        ]);
        setGroup(groupResult.group);
        setMessages(messagesResult.messages || []);
        setClearedAt(messagesResult.cleared_at || null);
        setPinnedMessage(messagesResult.pinned_message || null);
        setBadgeData({
          badges: badgesResult.badges || [],
          assignments: badgesResult.assignments || [],
        });
        // Mark as read when entering the chat
        markGroupRead(groupId);
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Error al cargar el chat', 'error');
      } finally {
        setLoading(false);
        setLoadingIdentities(false);
      }
    }
    load();
  }, [groupId]);

  useEffect(() => {
    if (!loading) setTimeout(() => scrollToBottom(false), 50);
  }, [loading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Mark as read whenever new messages arrive while viewing the chat
  useEffect(() => {
    if (messages.length > 0) markGroupRead(groupId);
  }, [messages.length, groupId]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`group-chat-${groupId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${groupId}`,
      }, async (payload) => {
        if (payload.new?.sender_id === profile.id) return;
        const { data } = await supabase
          .from('group_messages')
          .select(`id, group_id, sender_id, content, type, poll_options, created_at, reply_to_id, reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)), sender:sender_id(id, username, avatar_url, battery_level)`)
          .eq('id', payload.new.id)
          .single();
        if (data) {
          if (data.type === 'poll') {
            data.poll = { options: data.poll_options || [], votes: (data.poll_options || []).map(() => 0), totalVotes: 0, myVote: null };
          }
          setMessages(m => [...m, data]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [groupId, profile?.id]);

  // Realtime: recuentos de votos en vivo para las encuestas de este grupo
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`group-poll-votes-${groupId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'group_message_poll_votes',
        filter: `group_id=eq.${groupId}`,
      }, async (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        if (!messageId) return;
        try {
          const data = await api.get(`/groups/${groupId}/messages/${messageId}/poll`);
          setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, poll: data.poll } : m)));
        } catch {
          // non-critical
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [groupId]);

  // Realtime: mensaje fijado/desfijado por el administrador del grupo
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`group-pin-${groupId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'friend_groups',
        filter: `id=eq.${groupId}`,
      }, async () => {
        try {
          const data = await api.get(`/groups/${groupId}/messages`);
          setPinnedMessage(data.pinned_message || null);
        } catch {
          // non-critical
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [groupId]);

  const isOwner = group?.owner?.id === profile?.id;
  // Cualquier miembro del grupo puede fijar/desfijar mensajes, no solo el admin.
  const canPinMessages = true;
  const isPinnedMessage = (messageId) => pinnedMessage?.id === messageId;
  const [contextMenu, setContextMenu] = useState(null); // { msg }

  async function handleTogglePin(messageId, isPinned) {
    try {
      if (isPinned) {
        await api.delete(`/groups/${groupId}/pin`);
        setPinnedMessage(null);
        showToast('Mensaje desfijado');
      } else {
        const target = messages.find(m => m.id === messageId);
        const result = await api.post(`/groups/${groupId}/messages/${messageId}/pin`);
        setPinnedMessage(target ? {
          ...target,
          pinned_at: result.pinned_at,
          pinned_by: { id: profile?.id, username: profile?.username },
        } : null);
        showToast('Mensaje fijado');
      }
    } catch (e) {
      showToast('Error al fijar el mensaje', 'error');
    }
  }

  async function toggleLike(msg) {
    setContextMenu(null);
    try {
      const { message: updated } = await api.patch(`/groups/${groupId}/messages/${msg.id}/like`);
      setMessages(m => m.map(x => x.id === msg.id ? { ...x, ...updated } : x));
    } catch (e) {
      showToast(e.message || 'Error al reaccionar', 'error');
    }
  }

  async function deleteMessage(msg, scope) {
    setContextMenu(null);
    try {
      const { message: updated } = await api.patch(`/groups/${groupId}/messages/${msg.id}`, { scope });
      if (scope === 'me') {
        setMessages(m => m.filter(x => x.id !== msg.id));
      } else {
        setMessages(m => m.map(x => x.id === msg.id ? { ...x, ...updated } : x));
      }
      showToast(scope === 'me' ? 'Mensaje eliminado' : 'Mensaje eliminado para todos');
    } catch (e) {
      showToast(e.message || 'Error al eliminar', 'error');
    }
  }

  // Salta al mensaje original al tocar una cita (como en MessagesPage.jsx /
  // PoolChatPage.jsx). Si el mensaje ya no está cargado en pantalla, no hace nada.
  const scrollToMessage = useCallback((messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-accent-primary/70', 'rounded-2xl');
    setTimeout(() => el.classList.remove('ring-2', 'ring-accent-primary/70', 'rounded-2xl'), 1000);
  }, []);

  function jumpToPinnedMessage() {
    if (!pinnedMessage) return;
    scrollToMessage(pinnedMessage.id);
  }

  function handleSetGroupWallpaper(dataUrl) {
    setGroupWallpaper(groupId, dataUrl);
    setGroupWallpaperState(dataUrl);
  }

  function handleClearGroupWallpaper() {
    setGroupWallpaper(groupId, null);
    setGroupWallpaperState(null);
  }

  async function clearChat() {
    setClearingChat(true);
    try {
      await api.post(`/groups/${groupId}/clear`);
      setClearedAt(new Date().toISOString());
      setShowClearConfirm(false);
      showToast('Chat vaciado');
    } catch (e) {
      showToast('Error al vaciar el chat', 'error');
    } finally {
      setClearingChat(false);
    }
  }

  async function handleToggleMute() {
    const next = !group?.is_muted;
    setGroup(prev => prev ? { ...prev, is_muted: next } : prev); // optimista
    try {
      await api.patch(`/groups/${groupId}/mute`, { muted: next });
      window.dispatchEvent(new CustomEvent('sb-group-muted', { detail: { group_id: groupId, muted: next } }));
      showToast(next ? 'Grupo silenciado' : 'Notificaciones activadas');
    } catch (e) {
      setGroup(prev => prev ? { ...prev, is_muted: !next } : prev); // revertir
      showToast('Error al cambiar el silencio del grupo', 'error');
    }
  }

  function handleMemberAdded(friend) {
    setGroup(prev => {
      if (!prev) return prev;
      const alreadyThere = prev.members.some(m => m.id === friend.id);
      if (alreadyThere) return prev;
      const newMembers = [...prev.members, friend];
      return { ...prev, members: newMembers, member_count: newMembers.length };
    });
    showToast(`${friend.username} añadido al grupo`);
  }

  async function handleLeaveGroup() {
    try {
      await api.delete(`/groups/${groupId}/members/${profile.id}`);
      navigate('/messages', { replace: true });
    } catch (e) {
      console.error(e);
      showToast('Error al salir del grupo', 'error');
    }
  }

  async function handleDeleteGroup() {
    try {
      await api.delete(`/groups/${groupId}`);
      navigate('/messages', { replace: true });
    } catch (e) {
      console.error(e);
      showToast('Error al eliminar el grupo', 'error');
    }
  }

  async function handleRemoveMember(memberId) {
    try {
      await api.delete(`/groups/${groupId}/members/${memberId}`);
      setGroup(prev => {
        if (!prev) return prev;
        const newMembers = prev.members.filter(m => m.id !== memberId);
        return { ...prev, members: newMembers, member_count: newMembers.length };
      });
      showToast('Miembro expulsado del grupo');
    } catch (e) {
      console.error(e);
      showToast('Error al expulsar al miembro', 'error');
    }
  }

  async function sendText() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    const replyTarget = replyingTo;
    setInput('');
    setReplyingTo(null);
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      sender_id: profile.id,
      sender: { id: profile.id, username: profile.username, avatar_url: profile.avatar_url },
      content,
      type: 'text',
      created_at: new Date().toISOString(),
      reply_to_id: replyTarget?.id || null,
      reply_to: replyTarget ? {
        id: replyTarget.id,
        sender_id: replyTarget.sender_id,
        content: replyTarget.content,
        type: replyTarget.type,
        deleted_for_everyone: replyTarget.deleted_for_everyone,
        sender: replyTarget.sender,
      } : null,
    };
    setMessages(m => [...m, optimistic]);

    try {
      const { message } = await api.post(`/groups/${groupId}/messages`, {
        content, type: 'text',
        ...(replyTarget?.id ? { reply_to_id: replyTarget.id } : {}),
      });
      setMessages(m => m.map(msg => msg.id === optimistic.id ? message : msg));
    } catch (e) {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setInput(content);
      setReplyingTo(replyTarget);
      showToast('Error al enviar', 'error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleGroupPhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const replyTarget = replyingTo;
    setSendingImage(true);
    setReplyingTo(null);

    const localUrl = URL.createObjectURL(file);
    const optimisticId = `opt-img-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      sender_id: profile.id,
      sender: { id: profile.id, username: profile.username, avatar_url: profile.avatar_url },
      content: localUrl,
      type: 'image',
      created_at: new Date().toISOString(),
      reply_to_id: replyTarget?.id || null,
      reply_to: replyTarget ? {
        id: replyTarget.id,
        sender_id: replyTarget.sender_id,
        content: replyTarget.content,
        type: replyTarget.type,
        deleted_for_everyone: replyTarget.deleted_for_everyone,
        sender: replyTarget.sender,
      } : null,
    };
    setMessages(m => [...m, optimistic]);

    try {
      const formData = new FormData();
      formData.append('image', file);
      if (replyTarget?.id) formData.append('reply_to_id', replyTarget.id);
      const { message } = await api.postForm(`/groups/${groupId}/messages/image`, formData);
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.map(msg => msg.id === optimisticId ? message : msg));
    } catch (e) {
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.filter(msg => msg.id !== optimisticId));
      showToast('Error al enviar la imagen', 'error');
    } finally {
      setSendingImage(false);
    }
  }

  const visibleMessages = messages.filter(msg => {
    if (clearedAt && new Date(msg.created_at) <= new Date(clearedAt)) return false;
    if (Array.isArray(msg.deleted_for_self) && msg.deleted_for_self.includes(profile?.id)) return false;
    return true;
  });

  async function handleCreatePoll(question, options) {
    const { message } = await api.post(`/groups/${groupId}/polls`, { question, options });
    setMessages(m => [...m, message]);
    showToast('Encuesta enviada 📊');
  }

  async function handleVote(messageId, optionIndex, isMine) {
    if (votingMessageId) return;
    setVotingMessageId(messageId);
    try {
      const data = isMine
        ? await api.delete(`/groups/${groupId}/messages/${messageId}/vote`)
        : await api.post(`/groups/${groupId}/messages/${messageId}/vote`, { optionIndex });
      setMessages(m => m.map(msg => (msg.id === messageId ? { ...msg, poll: data.poll } : msg)));
    } catch (e) {
      showToast(e.message || 'Error al votar', 'error');
    } finally {
      setVotingMessageId(null);
    }
  }

  const identityByUserId = badgeData.assignments.reduce((acc, a) => {
    acc[a.userId] = a;
    return acc;
  }, {});

  const grouped = [];
  let lastDate = null;
  visibleMessages.forEach(msg => {
    const d = new Date(msg.created_at).toDateString();
    if (d !== lastDate) {
      grouped.push({ type: 'date', date: d, key: `date-${d}` });
      lastDate = d;
    }
    grouped.push({ type: 'msg', msg, key: msg.id });
  });

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display text-sm font-semibold shadow-2xl animate-slide-up ${
          toast.type === 'error'
            ? 'bg-red-500/20 text-red-300 border border-red-500/30'
            : 'bg-green-500/20 text-green-300 border border-green-500/30'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <nav className="border-b border-surface-border bg-surface-bg/90 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">←</button>
          {group ? (
            <button
              onClick={() => setShowGroupInfo(open => !open)}
              className="flex-1 min-w-0 text-left group"
              title="Ver integrantes e identidades"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg flex-shrink-0">👥</span>
                <span className="font-display font-bold text-surface-text truncate group-hover:text-accent-glow transition-colors">
                  {group.name}
                </span>
                <span className="text-xs text-surface-muted flex-shrink-0">
                  {showGroupInfo ? '^' : 'v'}
                </span>
              </div>
              <div className="text-xs text-surface-muted font-mono">
                {group.member_count} miembros · {badgeData.assignments.length} identidades
              </div>
            </button>
          ) : loading ? (
            <div className="flex-1 h-8 bg-surface-card rounded-xl animate-pulse" />
          ) : null}

          {/* Botón "Quedada" — atajo para crear una quedada privada con este
              grupo ya preseleccionado, sin tener que ir al menú Quedadas y
              rellenar el grupo a mano. Va a la izquierda del menú (⋯). */}
          {group && (
            <button
              onClick={() => navigate(`/pools?createPool=1&groupId=${group.id}`)}
              className="flex-shrink-0 px-3 h-9 rounded-xl text-xs font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/20 hover:bg-accent-primary/20 transition-all flex items-center gap-1.5"
              title="Crear una quedada con este grupo"
            >
              <span>🗓️</span> Quedada
            </button>
          )}

          {/* Menú de opciones (⋯) — mismo patrón que en el chat individual
              (MessagesPage.jsx). Sustituye a los botones sueltos de fondo
              (🖼️) e info (ℹ️): el nombre del grupo ya abre el panel de
              información al pincharlo, así que ese botón sobraba. */}
          {group && (
            <div className="relative flex-shrink-0" ref={headerMenuRef}>
              <button
                onClick={() => setShowHeaderMenu(v => !v)}
                className="w-9 h-9 rounded-xl text-surface-muted hover:text-surface-text hover:bg-surface-card border border-transparent hover:border-surface-border transition-all flex items-center justify-center text-xl font-bold"
                title="Opciones"
              >
                ⋯
              </button>
              {showHeaderMenu && (
                <div className="absolute right-0 top-11 bg-surface-card border border-surface-border rounded-2xl shadow-2xl z-30 min-w-[180px] py-1.5 overflow-hidden">
                  <button
                    onClick={() => { setShowHeaderMenu(false); setShowWallpaperModal(true); }}
                    className="w-full text-left px-4 py-3 text-sm font-display font-semibold text-surface-text hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                  >
                    <span>🖼️</span> Fondo del grupo{groupWallpaper ? ' (activo)' : ''}
                  </button>
                  <button
                    onClick={() => { setShowHeaderMenu(false); handleToggleMute(); }}
                    className="w-full text-left px-4 py-3 text-sm font-display font-semibold text-surface-text hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                  >
                    <span>{group.is_muted ? '🔔' : '🔕'}</span> {group.is_muted ? 'Activar notificaciones' : 'Silenciar grupo'}
                  </button>
                  <button
                    onClick={() => { setShowHeaderMenu(false); setShowClearConfirm(true); }}
                    className="w-full text-left px-4 py-3 text-sm font-display font-semibold text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
                  >
                    <span>🧹</span> Vaciar chat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      {group && showGroupInfo && (
        <GroupInfoPanel
          group={group}
          assignments={badgeData.assignments}
          loading={loadingIdentities}
          currentUserId={profile?.id}
          onOpenUser={(userId) => navigate(`/user/${userId}`)}
          onAddMember={() => setShowAddMember(true)}
          onLeaveGroup={handleLeaveGroup}
          onDeleteGroup={handleDeleteGroup}
          onRemoveMember={handleRemoveMember}
        />
      )}

      {/* Messages — group wallpaper */}
      <div
        className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 space-y-3"
        style={groupWallpaper ? {
          backgroundImage: `url(${groupWallpaper})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'local',
        } : {}}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32 text-surface-muted text-sm animate-pulse">
            Cargando mensajes...
          </div>
        ) : (
          <>
            <PinnedBanner
              pinned={pinnedMessage}
              canUnpin={canPinMessages}
              onUnpin={() => handleTogglePin(pinnedMessage.id, true)}
              onJumpTo={jumpToPinnedMessage}
            />
            {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-4xl">👥</div>
            <p className="text-slate-500 text-sm">
              {clearedAt ? 'Chat vaciado. ¡Sé el primero en escribir!' : '¡El chat está vacío! Sé el primero en escribir.'}
            </p>
          </div>
        ) : (
          grouped.map(item => {
            if (item.type === 'date') return <DateDivider key={item.key} date={item.date} />;
            const msg = item.msg;
            const isMe = msg.sender_id === profile?.id || msg.sender?.id === profile?.id;

            if (msg.deleted_for_everyone) {
              return <DeletedBubble key={item.key} isMe={isMe} msgId={msg.id} />;
            }

            if (msg.type === 'image') {
              return (
                <ImageBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  myBubbleStyle={myBubbleStyle}
                  otherBubbleStyle={otherBubbleStyle}
                  identity={identityByUserId[msg.sender_id || msg.sender?.id]}
                  onLongPress={setContextMenu}
                  onQuoteClick={scrollToMessage}
                  currentUserId={profile?.id}
                />
              );
            }

            if (msg.type === 'poll') {
              return (
                <PollBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  identity={identityByUserId[msg.sender_id || msg.sender?.id]}
                  onVote={handleVote}
                  voting={votingMessageId}
                  onLongPress={setContextMenu}
                  onQuoteClick={scrollToMessage}
                  currentUserId={profile?.id}
                />
              );
            }

            return (
              <TextBubble
                key={item.key}
                msg={msg}
                isMe={isMe}
                myBubbleStyle={myBubbleStyle}
                otherBubbleStyle={otherBubbleStyle}
                identity={identityByUserId[msg.sender_id || msg.sender?.id]}
                onLongPress={setContextMenu}
                onQuoteClick={scrollToMessage}
                currentUserId={profile?.id}
              />
            );
          })
        )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {contextMenu && (
        <MessageContextMenu
          msg={contextMenu}
          isMe={contextMenu.sender_id === profile?.id || contextMenu.sender?.id === profile?.id}
          isLiked={Array.isArray(contextMenu.liked_by) && contextMenu.liked_by.includes(profile?.id)}
          isPinned={isPinnedMessage(contextMenu.id)}
          canPin={canPinMessages}
          onClose={() => setContextMenu(null)}
          onReply={() => {
            setReplyingTo(contextMenu);
            setContextMenu(null);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onToggleLike={() => toggleLike(contextMenu)}
          onTogglePin={() => {
            handleTogglePin(contextMenu.id, isPinnedMessage(contextMenu.id));
            setContextMenu(null);
          }}
          onDeleteForMe={() => deleteMessage(contextMenu, 'me')}
          onDeleteForEveryone={() => deleteMessage(contextMenu, 'everyone')}
        />
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3">
          {replyingTo && (
            <ReplyComposerPreview
              replyingTo={replyingTo}
              label={replyingTo.sender_id === profile?.id ? 'ti mismo' : (replyingTo.sender?.username || 'este usuario')}
              onCancel={() => setReplyingTo(null)}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPhotoMenu(true)}
              title="Enviar foto"
              disabled={sendingImage}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all disabled:opacity-40"
            >
              {sendingImage ? (
                <span className="w-4 h-4 border-2 border-surface-muted border-t-transparent rounded-full animate-spin" />
              ) : '📷'}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleGroupPhotoSelect}
            />
            <input
              ref={photoCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleGroupPhotoSelect}
            />
            <PhotoSourceMenu
              open={showPhotoMenu}
              onClose={() => setShowPhotoMenu(false)}
              onCamera={() => photoCameraRef.current?.click()}
              onGallery={() => photoInputRef.current?.click()}
            />
            <button
              onClick={() => setShowPollModal(true)}
              title="Crear encuesta"
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all"
            >
              📊
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              placeholder="Escribe al grupo..."
              maxLength={1000}
              className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
            />
            <button
              onClick={sendText}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-primary disabled:opacity-40 text-surface-text flex items-center justify-center font-bold transition-all hover:bg-accent-primary/80 active:scale-95"
            >
              {sending ? '…' : '→'}
            </button>
          </div>
        </div>
      </div>

      {/* Wallpaper modal */}
      {showWallpaperModal && (
        <WallpaperModal
          current={groupWallpaper}
          onSet={handleSetGroupWallpaper}
          onClear={handleClearGroupWallpaper}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {/* Clear chat confirm */}
      {showClearConfirm && (
        <ConfirmModal
          title="Vaciar chat"
          message="Los mensajes desaparecerán solo para ti. El resto de miembros seguirá viendo el historial completo."
          confirmLabel={clearingChat ? 'Vaciando…' : 'Vaciar'}
          onConfirm={clearChat}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

      {/* Add member modal */}
      {showAddMember && group && (
        <AddMemberModal
          group={group}
          onClose={() => setShowAddMember(false)}
          onAdded={(friend) => {
            handleMemberAdded(friend);
            setShowAddMember(false);
          }}
        />
      )}

      {/* Create poll modal */}
      {showPollModal && (
        <CreatePollModal
          onClose={() => setShowPollModal(false)}
          onCreate={handleCreatePoll}
        />
      )}
    </div>
  );
}
