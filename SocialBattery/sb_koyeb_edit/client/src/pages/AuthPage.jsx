import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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
          <p className="text-surface-muted text-sm mb-6">
            Te hemos enviado un enlace de confirmación a <strong className="text-surface-text">{email}</strong>.
            Confírmalo y vuelve aquí para iniciar sesión.
          </p>
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

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50 text-surface-text font-display font-semibold py-3 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
                >
                  {loading ? '...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-surface-muted/60 text-xs mt-6 font-mono">
          SocialBattery v1.0 · Hecho con ⚡
        </p>
      </div>
    </div>
  );
}
