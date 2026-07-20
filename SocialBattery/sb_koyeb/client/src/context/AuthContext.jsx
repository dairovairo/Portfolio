import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import {
  interpretSignUpResult,
  isAlreadyConfirmedError,
  isEmailUnconfirmed,
} from '../lib/authFlow';
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
    muteSnifferCheckins,
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
    muteSnifferCheckins,
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
      .catch((err) => {
        // Distinguir "usuario no existe/token inválido" (401/404) — donde
        // TIENE sentido limpiar el perfil y que App.jsx redirija al login
        // o al onboarding — de errores transitorios (429 rate limit, 5xx,
        // red caída) donde NO queremos tocar el perfil porque no significa
        // que el usuario haya perdido acceso.
        //
        // Antes cualquier error hacía setProfile(null) y en pareja de
        // hermanos compartiendo IP el 429 nos "sacaba" al onboarding y
        // luego a la landing.
        const status = err?.status;
        if (status === 401 || status === 404) {
          setProfile(null);
        } else {
          // Error transitorio — mantenemos lo que hubiera (o null si es
          // el primer intento) y confiamos en el reintento automático
          // que hace api.js sobre 429 GETs. Si el usuario recarga o el
          // session cambia, este useEffect vuelve a correr.
          console.warn('[auth/me] error transitorio, manteniendo perfil:', status || err?.message);
        }
      })
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
    // Ver client/src/lib/authFlow.js — helpers puros con tests.
    // 'obfuscated' significa que Supabase nos ocultó un email ya
    // registrado; hay que probar resend para distinguir confirmado vs no.
    const result = interpretSignUpResult(data);
    if (result.kind === 'obfuscated') {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (resendError) {
        if (isAlreadyConfirmedError(resendError)) {
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
    // Puerta de confirmación en el cliente (ver isEmailUnconfirmed en
    // authFlow.js). Si el "Confirm email" del dashboard está apagado,
    // esta comprobación evita que cuentas sin confirmar entren igualmente.
    if (isEmailUnconfirmed(data?.user)) {
      await supabase.auth.signOut();
      throw new Error('Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada (y la carpeta de spam).');
    }
    return data;
  };

  const signInWithGoogle = async () => {
    // OAuth con Google via Supabase. Requiere que el provider "Google" esté
    // activado en el dashboard (Auth → Providers → Google) con Client ID y
    // Secret de Google Cloud Console, y que este origen esté en la lista de
    // "Redirect URLs" de Supabase.
    //
    // No hace navigate/setSession aquí: signInWithOAuth redirige la ventana
    // entera a la pantalla de Google, y al volver Supabase dispara el evento
    // SIGNED_IN sobre onAuthStateChange que ya tenemos escuchando arriba.
    //
    // redirectTo = window.location.origin para que, igual que en el signUp,
    // el callback vuelva al mismo dominio desde el que se inició el login
    // (protege ante cambios de dominio en la Site URL).
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        // queryParams para forzar selector de cuenta cada vez — útil en
        // móviles compartidos y en desarrollo. Si molesta a los usuarios
        // habituales se puede quitar sin más.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    return data;
  };

  const signInWithApple = async () => {
    // OAuth con Apple via Supabase (flujo web con Services ID + JWT
    // secret). Requiere config previa en dos sitios que NO se hacen desde
    // este código:
    //   1. Apple Developer Console (developer.apple.com/account):
    //      · App ID con capacidad "Sign In with Apple"
    //      · Services ID (será el "client_id" del flujo web) con Domains
    //        y Return URLs apuntando a la callback de Supabase
    //        (https://<project-ref>.supabase.co/auth/v1/callback)
    //      · Key (.p8) con permiso "Sign in with Apple"
    //   2. Supabase → Authentication → Providers → Apple:
    //      · Enable toggle ON
    //      · Client IDs: el Services ID creado arriba (primero de la lista
    //        si algún día añades apps nativas iOS con bundle IDs distintos)
    //      · Secret Key (for OAuth): JWT firmado con el .p8, generable
    //        desde la misma pantalla del dashboard con "Generate secret"
    //        — ese JWT caduca (máx 6 meses según Apple) así que hay que
    //        regenerarlo periódicamente
    //      · "Allow users without an email" ACTIVADO — Apple permite al
    //        usuario ocultar su email real (usa un email relay tipo
    //        xxx@privaterelay.appleid.com). Si este toggle está apagado,
    //        esos usuarios fallan al iniciar sesión sin mensaje claro.
    //
    // Igual que con Google, signInWithOAuth redirige la ventana entera;
    // al volver, Supabase dispara SIGNED_IN sobre onAuthStateChange que
    // ya está escuchando en el useEffect de arriba.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: window.location.origin,
      },
    });
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
      signInWithGoogle,
      signInWithApple,
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
