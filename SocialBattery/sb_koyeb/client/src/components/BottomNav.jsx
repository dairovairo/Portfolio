import { useNavigate, useLocation } from 'react-router-dom';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { usePoolChatNotifications } from '../context/PoolChatNotificationsContext';
import { usePoolInviteNotifications } from '../context/PoolInviteNotificationsContext';

const NAV_ITEMS = [
  { path: '/',                icon: '🏠', label: 'Inicio' },
  { path: '/pools',           icon: '📍', label: 'Quedadas' },
  { path: '/community',       icon: '🌐', label: 'Comunidad' },
  { path: '/messages/inbox',  icon: '💬', label: 'Mensajes' },
  { path: '/profile',         icon: '👤', label: 'Perfil' },
];

export default function BottomNav({ pendingCount = 0, unreadCount = 0 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventBadgeCount, planningUpdateCount } = useCommunityNotifications();
  const { poolChatBadgeCount } = usePoolChatNotifications();
  const { poolInviteBadgeCount } = usePoolInviteNotifications();
  const communityBadge = eventBadgeCount + planningUpdateCount;
  const poolsBadge = poolChatBadgeCount + poolInviteBadgeCount;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50
      bg-surface-bg/95 dark:bg-surface-bg/95 light:bg-white/95
      border-t border-surface-border backdrop-blur-xl
      pb-safe">
      <div className="flex items-center justify-around max-w-lg mx-auto px-2 h-16">
        {NAV_ITEMS.map(item => {
          const active = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          const badge =
            item.path === '/' ? pendingCount :
            item.path === '/messages/inbox' ? unreadCount :
            item.path === '/community' ? communityBadge :
            item.path === '/pools' ? poolsBadge : 0;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl
                transition-all duration-200 min-w-[52px]
                ${active
                  ? 'bg-accent-primary/15 text-accent-glow'
                  : 'text-slate-500 hover:text-slate-300 active:scale-95'
                }`}
            >
              <span className={`text-xl leading-none transition-transform duration-200 ${active ? 'scale-110' : ''}`}>
                {item.icon}
              </span>
              <span className={`text-[10px] font-mono transition-all ${active ? 'text-accent-glow' : 'text-slate-600'}`}>
                {item.label}
              </span>
              {badge > 0 && (
                <span className="absolute -top-0.5 right-1 bg-red-500 text-white text-[9px] font-bold
                  rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
