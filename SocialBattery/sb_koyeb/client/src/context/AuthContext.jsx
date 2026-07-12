import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { usePresenceBroadcast } from '../hooks/usePresence';
import { useMessageNotifications } from '../hooks/useMessageNotifications';
import { useSettings } from './SettingsContext';

const AuthContext = createContext(null);

function PresenceBroadcaster({ userId }) {
  const { showOnline } = useSettings();
  usePresenceBroadcast(userId, showOnline);
  return null;
}

function PrivacySettingsSyncer({ profile }) {
  const { syncPrivacyFromProfile } = useSettings();
  useEffect(() => {
    if (profile) syncPrivacyFromProfile(profile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);
  return null;
}

function MessageNotificationsBroadcaster({ profile }) {
  const {
    muteAllNotifications,
    mutePersonalChats,
    muteGroupChats,
    muteNewPools,
    muteEventReminders,
    mutePoolReminders,
    muteBatteryChanges,
    hydrateMutedConversations,
  } = useSettings();

  // Trae los chats silenciados desde el servidor una vez por sesión, para que
  // un silencio hecho en otro dispositivo (o antes de limpiar datos locales)
  // también se respete aquí — ver hydrateMutedConversations en SettingsContext.
  useEffect(() => {
    if (profile?.id) hydrateMutedConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useMessageNotifications(profile, {
    muteAllNotifications,
    mutePersonalChats,
    muteGroupChats,
    muteNewPools,
    muteEventReminders,
    mutePoolReminders,
    muteBatteryChanges,
  });
  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setSession(session);
      } else {
        setSession(session);
      }
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
    if (error) {
      if (/already|registered|exists/i.test(error.message || '')) {
        throw new Error('Esta cuenta ya pertenece a un usuario');
      }
      throw error;
    }
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Esta cuenta ya pertenece a un usuario');
    }
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  const updatePassword = async (password) => {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setIsPasswordRecovery(false);
    return data;
  };

  const clearPasswordRecovery = () => setIsPasswordRecovery(false);

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
      isPasswordRecovery,
      signUp,
      signIn,
      signOut,
      updatePassword,
      clearPasswordRecovery,
      refreshProfile,
      completeOnboarding,
    }}>
      {/* Heartbeat broadcaster — active when logged in with a profile */}
      {profile?.id && <PresenceBroadcaster userId={profile.id} />}
      {/* Sync privacy toggles from server profile on login / profile load */}
      {profile?.id && <PrivacySettingsSyncer profile={profile} />}
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
