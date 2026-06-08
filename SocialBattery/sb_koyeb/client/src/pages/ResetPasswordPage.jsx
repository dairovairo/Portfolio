import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ResetPasswordPage() {
  const { updatePassword, signOut } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
      // Give the user 2 seconds to read the confirmation, then go home
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setError(err.message || 'Algo salió mal. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center animate-fade-in">
          <div className="text-6xl mb-6">✅</div>
          <h2 className="font-display text-2xl font-bold text-surface-text mb-3">
            ¡Contraseña actualizada!
          </h2>
          <p className="text-surface-muted text-sm">
            Tu nueva contraseña ya está guardada. Redirigiendo...
          </p>
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
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-8">
          <div className="mb-6">
            <div className="text-3xl mb-3">🔑</div>
            <h2 className="font-display text-lg font-bold text-surface-text mb-1">
              Nueva contraseña
            </h2>
            <p className="text-surface-muted text-xs font-body leading-relaxed">
              Elige una contraseña segura de al menos 6 caracteres.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                Nueva contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                autoFocus
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                Confirmar contraseña
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
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
              {loading ? '...' : 'Guardar contraseña'}
            </button>

            <button
              type="button"
              onClick={async () => { await signOut(); navigate('/auth'); }}
              className="w-full text-surface-muted hover:text-surface-text text-sm transition-colors font-mono py-1"
            >
              Cancelar
            </button>
          </form>
        </div>

        <p className="text-center text-surface-muted/60 text-xs mt-6 font-mono">
          SocialBattery v1.0 · Hecho con ⚡
        </p>
      </div>
    </div>
  );
}
