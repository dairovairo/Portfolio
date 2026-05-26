import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import SettingsPage from './pages/SettingsPage';
import CommunityPage from './pages/CommunityPage';
import CommunityDetailPage from './pages/CommunityDetailPage';
import EventDetailPage from './pages/EventDetailPage';
import { CommunityNotificationsProvider } from './context/CommunityNotificationsContext';

function AppRoutes() {
  const { isLoading, isAuthenticated, hasProfile } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse-slow">🔋</div>
          <div className="text-surface-muted font-mono text-sm">Cargando...</div>
        </div>
      </div>
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
    <Routes>
      <Route path="/"                         element={<HomePage />} />
      <Route path="/auth"                     element={<Navigate to="/" replace />} />
      <Route path="/friends"                  element={<FriendsPage />} />
      <Route path="/profile"                  element={<ProfilePage />} />
      <Route path="/user/:id"                 element={<UserProfilePage />} />
      <Route path="/messages/inbox"           element={<MessagesInboxPage />} />
      <Route path="/messages/group/:groupId"  element={<GroupChatPage />} />
      <Route path="/messages/:friendId"       element={<MessagesPage />} />
      <Route path="/pools"                    element={<PoolsPage />} />
      <Route path="/badges"                   element={<BadgesPage />} />
      <Route path="/settings"                 element={<SettingsPage />} />
      <Route path="/community"               element={<CommunityPage />} />
      <Route path="/community/event/:eventId"  element={<EventDetailPage />} />
      <Route path="/community/:communityId"   element={<CommunityDetailPage />} />
      <Route path="*"                         element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SettingsProvider>
          <ToastProvider>
            <AuthProvider>
              <CommunityNotificationsProvider>
                <AppRoutes />
              </CommunityNotificationsProvider>
            </AuthProvider>
          </ToastProvider>
        </SettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
