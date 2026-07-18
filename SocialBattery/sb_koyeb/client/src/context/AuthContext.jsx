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
    mutePoolChats,
    muteCommunityChats,
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
    mutePoolChats,
    muteCommunityChats,
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
    // El link de confirmación de correo lo genera Supabase a partir de la
    // "Site URL" configurada en su dashboard. Si esa Site URL se queda
    // apuntando al dominio viejo (ha pasado ya al mover el proyecto a
    // socialbattery.pro), el email lleva al usuario al frontend antiguo,
    // que ya no tiene un backend accesible → el fetch a /auth/me falla
    // sin llegar a hacer round-trip y salta "No se pudo conectar con el
    // servidor" en móviles (en PC no se nota porque el usuario suele
    // volver a la pestaña ya activa donde había hecho el signUp).
    //
    // Pasando emailRedirectTo desde el cliente, el link del email vuelve
    // SIEMPRE al mismo origen desde el que se hizo el registro — con
    // independencia de lo que ponga la Site URL. Es la manera de
    // blindarnos ante futuros cambios de dominio: la config de Supabase
    // seguirá siendo importante (Redirect URLs debe permitir este origen)
    // pero deja de ser la única fuente de verdad. window.location.origin
    // es el protocolo + host + puerto actual — exactamente el dominio que
    // el usuario está viendo.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      // Errores "reales" del signUp (contraseña débil, email inválido,
      // rate limit, etc). No los intentamos mapear a "cuenta ya existe"
      // porque para ese caso Supabase NO devuelve error, sino data
      // ofuscada (ver más abajo).
      throw error;
    }
    // Supabase, cuando "Confirm email" está activo, ofusca el caso de
    // email ya registrado: devuelve un data.user con identities=[] y sin
    // error, para evitar enumeración de correos. El problema es que no
    // podemos distinguir aquí entre:
    //   (a) cuenta ya existe Y CONFIRMADA → hay que decir que está en uso
    //   (b) cuenta existe pero SIN CONFIRMAR → hay que reenviarle el mail
    //       de confirmación y llevarle a "revisa tu email"
    // La forma robusta de distinguirlos es intentar el resend:
    //   - si el usuario existe sin confirmar, el resend funciona y el
    //     correo sale de nuevo → tratamos el signUp como exitoso, la
    //     UI muestra la pantalla de "te hemos enviado un correo".
    //   - si el usuario ya está confirmado, resend falla con un error
    //     tipo "User already confirmed" / "already been confirmed"
    //     → mostramos "esta cuenta ya pertenece a un usuario".
    // Si el resend falla por rate limit u otro motivo transitorio,
    // seguimos llevándole a la pantalla de "revisa tu email" (la cuenta
    // existe, así que es la instrucción correcta) en vez de dar un error
    // que le haría pensar que el registro no ha ocurrido.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (resendError) {
        const msg = resendError.message || '';
        if (/already.*confirmed|confirmed.*already|has been confirmed/i.test(msg)) {
          throw new Error('Esta cuenta ya pertenece a un usuario');
        }
        // Rate limit / otro: no bloqueamos el flujo, la cuenta existe y
        // el usuario debe seguir mirando su correo. La pantalla siguiente
        // tiene botón de "reenviar" con cooldown para reintentar.
      }
    }
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Puerta de confirmación de email en el cliente. Si el proyecto de
    // Supabase tiene "Confirm email" activo, signInWithPassword ya falla
    // antes con "Email not confirmed" y este check es redundante. Pero si
    // ese ajuste está apagado (o se apaga por error en el dashboard), sin
    // este check una cuenta que se acaba de registrar y no ha pinchado el
    // enlace del correo entraría igual — que es justo el bug reportado.
    // Comprobamos ambos campos porque las versiones antiguas de gotrue
    // usaban confirmed_at y las nuevas email_confirmed_at.
    const u = data?.user;
    if (u && !u.email_confirmed_at && !u.confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada (y la carpeta de spam).');
    }
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
