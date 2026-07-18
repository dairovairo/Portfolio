import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import PoolSnifferPage from './pages/PoolSnifferPage';
import SettingsPage from './pages/SettingsPage';
import CommunityPage from './pages/CommunityPage';
import CommunityDetailPage from './pages/CommunityDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import EventLocatorPage from './pages/EventLocatorPage';
import RaffleAdAudiencePage from './pages/RaffleAdAudiencePage';
import CommunityDashboardPage from './pages/CommunityDashboardPage';
import EventAdConfigPage from './pages/EventAdConfigPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import LandingPage from './pages/LandingPage';
import ShopPage from './pages/ShopPage';
import CalendarPage from './pages/CalendarPage';
import { CommunityNotificationsProvider } from './context/CommunityNotificationsContext';
import { PoolChatNotificationsProvider } from './context/PoolChatNotificationsContext';
import { PoolInviteNotificationsProvider } from './context/PoolInviteNotificationsContext';
import { TutorialProvider } from './context/TutorialContext';
import { MascotProvider } from './context/MascotContext';
import { UserLocationProvider, useUserLocation } from './context/UserLocationContext';
import MascotPreviewSync from './components/MascotPreviewSync';

function AppRoutes() {
  const { isLoading, isAuthenticated, hasProfile, isPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { requestLocationOnce } = useUserLocation();

  // Se pide el permiso de ubicación una única vez, nada más entrar en la app
  // ya autenticado y con el perfil completo (no tiene sentido pedirlo en el
  // login ni durante el onboarding). Se usa para ordenar/filtrar eventos por
  // cercanía en el menú Comunidad — ver CommunityPage.jsx.
  useEffect(() => {
    if (isAuthenticated && hasProfile) {
      requestLocationOnce();
    }
  }, [isAuthenticated, hasProfile, requestLocationOnce]);

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

  // Rutas 100% públicas — se comprueban DESPUÉS de declarar todos los
  // hooks de arriba (para no romper las reglas de hooks si el pathname
  // cambia sin desmontar AppRoutes) pero ANTES que cualquier chequeo de
  // sesión (isLoading / isAuthenticated / hasProfile).
  //
  // Aquí incluimos también "/" con la LandingPage: si esperáramos a
  // que isLoading resolviera, durante los milisegundos que tarda
  // supabase.auth.getSession() el bot de Google Cloud (que ejecuta JS
  // headless para verificar el OAuth consent screen) solo vería el
  // spinner "Cargando..." — sin `<h1>SocialBattery</h1>` ni descripción
  // del propósito de la app. Eso disparaba exactamente los dos errores
  // de verificación:
  //   "el nombre no coincide con la pantalla de consentimiento"
  //   "no se explica el propósito de la app"
  // porque en el momento que el bot capturaba el DOM, la landing aún no
  // había montado. Renderizándola directamente en "/" sin gating por
  // sesión, el bot ve inmediatamente el contenido correcto.
  //
  // Para usuarios autenticados que naveguen a "/", el redirect a
  // /home lo hace el propio botón/flujo de la landing (o el useEffect
  // más abajo si volvieran a montar la app desde cero). En cualquier
  // caso mostrar brevemente la landing a un usuario autenticado no es
  // problema, es igualmente contenido válido de la app.
  const PUBLIC_ROUTES = {
    '/': LandingPage,
    '/privacidad': PrivacyPolicyPage,
  };
  const PublicPage = PUBLIC_ROUTES[location.pathname];
  if (PublicPage) {
    return (
      <Routes>
        <Route path={location.pathname} element={<PublicPage />} />
      </Routes>
    );
  }

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
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
      <Route path="/pools/:poolId/sniffer"    element={<PoolSnifferPage />} />
      <Route path="/badges"                   element={<BadgesPage />} />
      <Route path="/settings"                 element={<SettingsPage />} />
      <Route path="/shop"                     element={<ShopPage />} />
      <Route path="/calendar"                 element={<CalendarPage />} />
      <Route path="/community"               element={<CommunityPage />} />
      <Route path="/community/event-publicidad" element={<EventAdConfigPage />} />
      <Route path="/community/event/:eventId"  element={<EventDetailPage />} />
      <Route path="/community/event/:eventId/locator" element={<EventLocatorPage />} />
      <Route path="/community/:communityId"   element={<CommunityDetailPage />} />
      <Route path="/community/:communityId/raffle-publicidad" element={<RaffleAdAudiencePage />} />
      <Route path="/community/:communityId/dashboard" element={<CommunityDashboardPage />} />
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
              <UserLocationProvider>
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
              </UserLocationProvider>
            </AuthProvider>
          </ToastProvider>
        </SettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
