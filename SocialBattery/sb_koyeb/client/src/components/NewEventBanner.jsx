import { useNavigate } from 'react-router-dom';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';

// ── Banner pequeño mostrado arriba del todo en el home cuando llega la
//    notificación de un evento nuevo (básico/premium/ultra). Al pulsarlo,
//    lleva a la ficha del evento dentro de comunidad → eventos.
export default function NewEventBanner() {
  const navigate = useNavigate();
  const { newEventBanner, dismissEventBanner } = useCommunityNotifications();

  if (!newEventBanner) return null;

  const { id, title, coverImageUrl } = newEventBanner;

  function handleOpen() {
    dismissEventBanner();
    navigate(`/community/event/${id}`);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen(); }}
      className="flex items-center gap-3 bg-surface-card border border-accent-primary/30 rounded-2xl px-3 py-2.5 cursor-pointer animate-slide-down shadow-lg shadow-accent-primary/10 hover:border-accent-primary/50 transition-colors"
    >
      <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-surface-bg border border-surface-border flex items-center justify-center">
        {coverImageUrl
          ? <img src={coverImageUrl} alt="" className="w-full h-full object-cover" />
          : <span className="text-xl" aria-hidden="true">📅</span>
        }
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-text leading-snug truncate">
          <span className="text-surface-muted">Nuevo evento: </span>
          <span className="font-semibold">{title}</span>
        </p>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); dismissEventBanner(); }}
        className="p-1.5 -mr-1 text-surface-muted hover:text-surface-text flex-shrink-0 transition-colors"
        aria-label="Cerrar"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
