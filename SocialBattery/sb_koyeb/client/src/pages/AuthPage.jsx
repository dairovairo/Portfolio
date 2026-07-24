import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import LogoWordmark from '../components/LogoWordmark';

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, signInWithApple } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  // Consentimiento único para (a) declarar +16 años y (b) aceptar los
  // ToS y Política de Privacidad. Requisito de tiendas + de la propia
  // ley: el consentimiento debe ser explícito y positivo (no una casilla
  // pre-marcada). Solo aplica al registro; iniciar sesión con una cuenta
  // ya creada no vuelve a pedirlo. Google/Apple sign-in también lo exige
  // porque en muchos casos crean la cuenta al vuelo.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resendState, setResendState] = useState('idle'); // 'idle' | 'sending' | 'sent'
  const [resendCooldown, setResendCooldown] = useState(0);

  async function handleGoogleSignIn() {
    if (loading) return;
    // En modo registro, exige el checkbox — Google/Apple crean cuenta al
    // vuelo si no existía, y la ley/tiendas exigen consentimiento explícito
    // antes de crearla.
    if (mode === 'register' && !termsAccepted) {
      setError('Debes aceptar los términos y confirmar que tienes al menos 16 años.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // signInWithGoogle redirige la ventana entera, así que normalmente
      // este await no resuelve (el navegador ya se ha ido). Sólo llegamos
      // aquí si Supabase responde con error antes de redirigir (provider
      // no configurado, URL no permitida, etc.).
      await signInWithGoogle();
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión con Google');
      setLoading(false);
    }
  }

  async function handleAppleSignIn() {
    if (loading) return;
    // Ver comentario en handleGoogleSignIn — mismo motivo.
    if (mode === 'register' && !termsAccepted) {
      setError('Debes aceptar los términos y confirmar que tienes al menos 16 años.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Igual comportamiento que Google: redirige la ventana entera y
      // este await raramente resuelve — sólo si hay error antes del
      // redirect (Apple provider no configurado, JWT secret caducado,
      // Services ID mal, etc.).
      await signInWithApple();
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión con Apple');
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (resendCooldown > 0 || resendState === 'sending') return;
    setResendState('sending');
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
      if (resendError) throw resendError;
      setResendState('sent');
      setResendCooldown(30);
      const timer = setInterval(() => {
        setResendCooldown((s) => {
          if (s <= 1) { clearInterval(timer); return 0; }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err.message || 'No se pudo reenviar el correo');
      setResendState('idle');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate('/');
      } else if (mode === 'register') {
        if (!termsAccepted) {
          throw new Error('Debes aceptar los términos y confirmar que tienes al menos 16 años.');
        }
        await signUp(email, password);
        setRegistered(true);
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setResetSent(true);
      }
    } catch (err) {
      setError(err.message || 'Algo salió mal');
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">📬</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            Revisa tu email
          </h2>
          <p className="text-surface-muted text-sm mb-4">
            Te hemos enviado un enlace de confirmación a <strong className="text-surface-text">{email}</strong>.
            Confírmalo y vuelve aquí para iniciar sesión.
          </p>
          <p className="text-surface-muted text-xs mb-6">
            Si no lo ves en unos minutos, revisa la carpeta de <strong className="text-surface-text">Spam / No deseado</strong>
            {' '}(en Outlook también la pestaña <strong className="text-surface-text">Otros</strong>) antes de reenviarlo.
          </p>
          <button
            onClick={handleResendConfirmation}
            disabled={resendCooldown > 0 || resendState === 'sending'}
            className="text-accent-glow text-sm underline underline-offset-4 disabled:opacity-50 disabled:no-underline"
          >
            {resendState === 'sending'
              ? 'Reenviando...'
              : resendCooldown > 0
                ? `Reenviar correo (${resendCooldown}s)`
                : resendState === 'sent'
                  ? '✓ Reenviado — reenviar de nuevo'
                  : 'Reenviar correo de confirmación'}
          </button>
          {error && (
            <p className="text-red-400 text-xs mt-3">{error}</p>
          )}
        </div>
      </div>
    );
  }

  if (resetSent) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">🔑</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            Revisa tu email
          </h2>
          <p className="text-surface-muted text-sm mb-6">
            Hemos enviado un enlace para restablecer tu contraseña a{' '}
            <strong className="text-surface-text">{email}</strong>.
            Revisa también la carpeta de spam.
          </p>
          <button
            onClick={() => { setMode('login'); setResetSent(false); setEmail(''); }}
            className="text-accent-glow text-sm underline underline-offset-4"
          >
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4 noise">
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-green-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-sm w-full animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <img src="/logo-icon.png" alt="SocialBattery" className="h-9 w-auto" />
            <h1 className="font-display text-3xl font-800 text-surface-text tracking-tight">
              <LogoWordmark />
            </h1>
          </div>
          <p className="text-surface-muted text-sm font-body">
            Sé honesto con tu energía social
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-8">

          {mode === 'forgot' ? (
            /* ── Forgot password view ── */
            <>
              <div className="mb-6">
                <h2 className="font-display text-lg font-bold text-surface-text mb-1">
                  ¿Olvidaste tu contraseña?
                </h2>
                <p className="text-surface-muted text-xs font-body leading-relaxed">
                  Introduce tu email y te enviaremos un enlace para restablecerla.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="tu@email.com"
                    className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
                  />
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50 text-surface-text font-display font-semibold py-3 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
                >
                  {loading ? '...' : 'Enviar enlace'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); }}
                  className="w-full text-surface-muted hover:text-surface-text text-sm transition-colors font-mono py-1"
                >
                  ← Volver al login
                </button>
              </form>
            </>
          ) : (
            /* ── Login / Register view ── */
            <>
              {/* Tabs */}
              <div className="flex bg-surface-bg rounded-xl p-1 mb-8">
                {['login', 'register'].map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setError(''); }}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium font-display transition-all duration-200 ${
                      mode === m
                        ? 'bg-accent-primary text-surface-text shadow-lg'
                        : 'text-surface-muted hover:text-surface-text'
                    }`}
                  >
                    {m === 'login' ? 'Entrar' : 'Registro'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="tu@email.com"
                    className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    minLength={6}
                    className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
                  />
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError(''); }}
                      className="mt-1.5 text-xs text-surface-muted hover:text-accent-glow transition-colors font-mono"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {mode === 'register' && (
                  <label className="flex items-start gap-2.5 text-xs text-surface-muted leading-relaxed cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-surface-border bg-surface-bg
                        text-accent-primary focus:ring-accent-primary/40 focus:ring-offset-0 shrink-0"
                    />
                    <span>
                      Confirmo que tengo al menos <strong className="text-surface-text">16 años</strong> y
                      acepto los{' '}
                      <Link to="/terminos" target="_blank" className="text-accent-glow underline underline-offset-2">
                        Términos y Condiciones
                      </Link>{' '}
                      y la{' '}
                      <Link to="/privacidad" target="_blank" className="text-accent-glow underline underline-offset-2">
                        Política de Privacidad
                      </Link>.
                    </span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50 text-surface-text font-display font-semibold py-3 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
                >
                  {loading ? '...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
                </button>
              </form>

              {/* ── Separador "o" ── */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-surface-border" />
                <span className="text-xs font-mono text-surface-muted uppercase tracking-widest">o</span>
                <div className="flex-1 h-px bg-surface-border" />
              </div>

              {/* ── Google sign-in ──
                  Botón fuera del <form> para que no dispare handleSubmit.
                  Estilo blanco tipo Material — es la guía de branding oficial
                  de Google para "Sign in with Google" y ayuda a que los
                  usuarios reconozcan el botón al instante. */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-800 font-display font-semibold py-3 rounded-xl transition-all duration-200"
              >
                {/* Logo oficial de Google en SVG inline — evita depender de
                    ningún asset externo o de red al cargar la pantalla. */}
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
                </svg>
                <span className="text-sm">
                  {mode === 'login' ? 'Entrar con Google' : 'Registrarse con Google'}
                </span>
              </button>

              {/* ── Apple sign-in ──
                  Fuera del <form> por la misma razón que Google. Estilo
                  negro con logo blanco siguiendo las guías oficiales de
                  branding de "Sign in with Apple" (fondo oscuro, logo y
                  texto blancos, radios de esquina similares al de Google
                  para coherencia visual dentro de la propia app). */}
              <button
                type="button"
                onClick={handleAppleSignIn}
                disabled={loading}
                className="w-full mt-3 flex items-center justify-center gap-3 bg-black hover:bg-neutral-900 disabled:opacity-50 text-white font-display font-semibold py-3 rounded-xl transition-all duration-200 border border-neutral-800"
              >
                {/* Logo manzana de Apple en SVG inline (path oficial,
                    no un asset de red ni una fuente) — así el botón es
                    autocontenido y no depende de descargar nada extra. */}
                <svg width="16" height="18" viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path fill="currentColor" d="M13.245 9.583c-.02-2.09 1.707-3.106 1.786-3.153-.974-1.423-2.487-1.618-3.023-1.638-1.287-.13-2.512.759-3.164.759-.66 0-1.667-.741-2.741-.72-1.41.02-2.71.82-3.436 2.084-1.465 2.54-.375 6.297 1.052 8.361.699 1.011 1.53 2.145 2.62 2.105 1.052-.043 1.448-.681 2.719-.681s1.628.681 2.74.658c1.13-.02 1.847-1.03 2.541-2.048.804-1.176 1.135-2.313 1.155-2.372-.025-.011-2.222-.852-2.249-3.355zM11.157 3.435c.582-.706.973-1.686.867-2.657-.837.034-1.85.557-2.451 1.263-.54.624-1.011 1.62-.885 2.573.933.072 1.886-.474 2.469-1.18z"/>
                </svg>
                <span className="text-sm">
                  {mode === 'login' ? 'Entrar con Apple' : 'Registrarse con Apple'}
                </span>
              </button>
            </>
          )}
        </div>

        <p className="text-center text-surface-muted/60 text-xs mt-6 font-mono">
          SocialBattery v1.0 · Hecho con ⚡
        </p>
        <p className="text-center text-xs mt-2">
          <a href="/privacidad" className="text-surface-muted/60 hover:text-surface-muted underline underline-offset-4 font-mono">
            Política de privacidad
          </a>
        </p>
      </div>
    </div>
  );
}
