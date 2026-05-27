import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const { signIn, signUp, resetPassword, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 'login' | 'register' | 'forgot' | 'reset'
  const [mode, setMode] = useState(() => searchParams.get('reset') === 'true' ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (searchParams.get('reset') === 'true') setMode('reset');
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate('/');
      } else if (mode === 'register') {
        await signUp(email, password);
        setRegistered(true);
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setResetSent(true);
      } else if (mode === 'reset') {
        if (password !== passwordConfirm) {
          setError('Las contraseñas no coinciden');
          return;
        }
        if (password.length < 6) {
          setError('La contraseña debe tener al menos 6 caracteres');
          return;
        }
        await updatePassword(password);
        setResetDone(true);
      }
    } catch (err) {
      setError(err.message || 'Algo salió mal');
    } finally {
      setLoading(false);
    }
  }

  // ── Registered success ────────────────────────────────────────────────────
  if (registered) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">📬</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            Revisa tu email
          </h2>
          <p className="text-surface-muted text-sm mb-6">
            Te hemos enviado un enlace de confirmación a <strong className="text-surface-text">{email}</strong>.
            Confírmalo y vuelve aquí para iniciar sesión.
          </p>
          <button
            onClick={() => { setMode('login'); setRegistered(false); }}
            className="text-accent-glow text-sm underline underline-offset-4"
          >
            Ir al login
          </button>
        </div>
      </div>
    );
  }

  // ── Reset link sent ───────────────────────────────────────────────────────
  if (resetSent) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">🔑</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            Revisa tu email
          </h2>
          <p className="text-surface-muted text-sm mb-6">
            Si <strong className="text-surface-text">{email}</strong> está registrado, recibirás un enlace para restablecer tu contraseña.
          </p>
          <button
            onClick={() => { setMode('login'); setResetSent(false); }}
            className="text-accent-glow text-sm underline underline-offset-4"
          >
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  // ── Password reset done ───────────────────────────────────────────────────
  if (resetDone) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">✅</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            Contraseña actualizada
          </h2>
          <p className="text-surface-muted text-sm mb-6">
            Tu contraseña se ha cambiado correctamente. Ya puedes iniciar sesión.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-xl bg-accent-primary text-white font-display font-semibold text-sm hover:bg-accent-primary/80 transition-all"
          >
            Ir a inicio
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';

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
            <span className="text-4xl">🔋</span>
            <h1 className="font-display text-3xl font-800 text-surface-text tracking-tight">
              SocialBattery
            </h1>
          </div>
          <p className="text-surface-muted text-sm font-body">
            Sé honesto con tu energía social
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-8">

          {/* Tabs — only for login/register */}
          {!isForgot && !isReset && (
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
          )}

          {/* Forgot / Reset header */}
          {(isForgot || isReset) && (
            <div className="mb-6">
              {!isReset && (
                <button
                  onClick={() => { setMode('login'); setError(''); }}
                  className="text-surface-muted hover:text-surface-text text-sm mb-4 flex items-center gap-1 transition-colors"
                >
                  ← Volver
                </button>
              )}
              <h2 className="font-display font-bold text-surface-text text-lg">
                {isReset ? '🔒 Nueva contraseña' : '🔑 Recuperar contraseña'}
              </h2>
              <p className="text-surface-muted text-xs mt-1">
                {isReset
                  ? 'Elige una nueva contraseña para tu cuenta.'
                  : 'Te enviaremos un enlace a tu email para restablecer la contraseña.'}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email — not shown in reset mode */}
            {!isReset && (
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
            )}

            {/* Password — not shown in forgot mode */}
            {!isForgot && (
              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                  {isReset ? 'Nueva contraseña' : 'Contraseña'}
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
              </div>
            )}

            {/* Confirm password — only in reset mode */}
            {isReset && (
              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={e => setPasswordConfirm(e.target.value)}
                  required
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
                />
              </div>
            )}

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
              {loading
                ? '...'
                : isReset
                  ? 'Cambiar contraseña'
                  : isForgot
                    ? 'Enviar enlace'
                    : mode === 'login'
                      ? 'Entrar'
                      : 'Crear cuenta'}
            </button>

            {/* Forgot password link — only on login tab */}
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); }}
                className="w-full text-center text-xs text-surface-muted hover:text-accent-glow transition-colors font-mono mt-1"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}
          </form>
        </div>

        <p className="text-center text-surface-muted/60 text-xs mt-6 font-mono">
          SocialBattery v1.0 · Hecho con ⚡
        </p>
      </div>
    </div>
  );
}
