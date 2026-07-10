import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { SettingsProvider } from './context/SettingsContext';
import AuthPage from './pages/AuthPage';
import OnboardingPage from './pages/OnboardingPage';
import HomePage from './pages/HomePage';
import FriendsPage from './pages/FriendsPage';
import ProfilePage from './pages/ProfilePage';
import UserProfilePage from './pages/UserProfilePage';
import MessagesPage from './pages/MessagesPage';
import MessagesInboxPage from './pages/MessagesInboxPage';
import PoolsPage from './pages/PoolsPage';
import BadgesPage from './pages/BadgesPage';
import GroupChatPage from './pages/GroupChatPage';
import CommunityChatPage from './pages/CommunityChatPage';
import PoolChatPage from './pages/PoolChatPage';
import SettingsPage from './pages/SettingsPage';
import CommunityPage from './pages/CommunityPage';
import CommunityDetailPage from './pages/CommunityDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ShopPage from './pages/ShopPage';
import { CommunityNotificationsProvider } from './context/CommunityNotificationsContext';
import { PoolChatNotificationsProvider } from './context/PoolChatNotificationsContext';
import { PoolInviteNotificationsProvider } from './context/PoolInviteNotificationsContext';
import { TutorialProvider } from './context/TutorialContext';
import { MascotProvider } from './context/MascotContext';
import MascotPreviewSync from './components/MascotPreviewSync';

function AppRoutes() {
  const { isLoading, isAuthenticated, hasProfile, isPasswordRecovery } = useAuth();
  const navigate = useNavigate();

  // El Service Worker (sw.js → notificationclick) nos manda esta URL cuando
  // el usuario toca una notificación con la app ya abierta, en vez de hacer
  // una recarga completa (client.navigate), para no depender de que el
  // hosting estático tenga configurado un rewrite SPA para rutas profundas.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    function handleMessage(event) {
      if (event.data?.type === 'sb-notification-click' && event.data.url) {
        navigate(event.data.url);
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center">
        <div className="text-center">
          <img src="/logo-icon.png" alt="SocialBattery" className="h-9 w-auto mx-auto mb-4 animate-pulse-slow" />
          <div className="text-surface-muted font-mono text-sm">Cargando...</div>
        </div>
      </div>
    );
  }

  // PASSWORD_RECOVERY: highest priority — always show reset page regardless of profile state
  if (isPasswordRecovery) {
    return (
      <Routes>
        <Route path="*" element={<ResetPasswordPage />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  if (!hasProfile) {
    return (
      <Routes>
        <Route path="/setup" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {/* Sin JSX propio — sube en segundo plano el retrato de la mascota
          equipada para que se vea personalizada en la tarjeta de amigo de
          los demás (ver FriendCard.jsx). */}
      <MascotPreviewSync />
      <Routes>
      <Route path="/"                         element={<HomePage />} />
      <Route path="/auth"                     element={<Navigate to="/" replace />} />
      <Route path="/friends"                  element={<FriendsPage />} />
      <Route path="/profile"                  element={<ProfilePage />} />
      <Route path="/user/:id"                 element={<UserProfilePage />} />
      <Route path="/messages/inbox"           element={<MessagesInboxPage />} />
      <Route path="/messages/group/:groupId"  element={<GroupChatPage />} />
      <Route path="/messages/community/:communityId"  element={<CommunityChatPage />} />
      <Route path="/messages/:friendId"       element={<MessagesPage />} />
      <Route path="/pools"                    element={<PoolsPage />} />
      <Route path="/pools/:poolId/chat"       element={<PoolChatPage />} />
      <Route path="/badges"                   element={<BadgesPage />} />
      <Route path="/settings"                 element={<SettingsPage />} />
      <Route path="/shop"                     element={<ShopPage />} />
      <Route path="/community"               element={<CommunityPage />} />
      <Route path="/community/event/:eventId"  element={<EventDetailPage />} />
      <Route path="/community/:communityId"   element={<CommunityDetailPage />} />
      <Route path="*"                         element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SettingsProvider>
          <ToastProvider>
            <AuthProvider>
              <TutorialProvider>
                <MascotProvider>
                <CommunityNotificationsProvider>
                <PoolChatNotificationsProvider>
                <PoolInviteNotificationsProvider>
                  <AppRoutes />
                </PoolInviteNotificationsProvider>
                </PoolChatNotificationsProvider>
                </CommunityNotificationsProvider>
                </MascotProvider>
              </TutorialProvider>
            </AuthProvider>
          </ToastProvider>
        </SettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
