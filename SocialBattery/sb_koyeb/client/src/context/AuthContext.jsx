import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { usePresenceBroadcast } from '../hooks/usePresence';
import { useMessageNotifications } from '../hooks/useMessageNotifications';
import { useSettings } from './SettingsContext';

const AuthContext = createContext(null);

function PresenceBroadcaster({ userId, showOnline }) {
  usePresenceBroadcast(userId, showOnline);
  return null;
}

function MessageNotificationsBroadcaster({ profile }) {
  const {
    muteAllNotifications,
    mutePersonalChats,
    muteGroupChats,
    muteBatteryChanges,
    showOnline,
    showLastSeen,
  } = useSettings();

  useMessageNotifications(profile, {
    muteAllNotifications,
    mutePersonalChats,
    muteGroupChats,
    muteBatteryChanges,
  });
  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    setLoadingProfile(true);
    api.get('/auth/me')
      .then(({ user }) => setProfile(user))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false));
  }, [session]);

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  const refreshProfile = async () => {
    const { user } = await api.get('/auth/me');
    setProfile(user);
    return user;
  };

  const completeOnboarding = async (profileData) => {
    const { user } = await api.post('/auth/profile', profileData);
    setProfile(user);
    return user;
  };

  return (
    <AuthContext.Provider value={{
      session,
      profile,
      loadingProfile,
      isLoading: session === undefined,
      isAuthenticated: !!session,
      hasProfile: !!profile,
      signUp,
      signIn,
      signOut,
      refreshProfile,
      completeOnboarding,
    }}>
      {/* Heartbeat broadcaster — active when logged in with a profile */}
      {profile?.id && <PresenceBroadcaster userId={profile.id} showOnline={showOnline} />}
      {/* Native notification listener — active when logged in with a profile */}
      {profile?.id && <MessageNotificationsBroadcaster profile={profile} />}
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
