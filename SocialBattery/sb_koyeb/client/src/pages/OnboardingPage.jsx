import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { getBatteryColor } from '../lib/battery';

const STEPS = [
  { id: 'welcome',  label: '¡Hola!' },
  { id: 'username', label: 'Tu nombre' },
  { id: 'avatar',   label: 'Tu foto' },
  { id: 'battery',  label: 'Tu energía' },
  { id: 'done',     label: '¡Listo!' },
];

function ProgressDots({ step }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {STEPS.map((s, i) => (
        <div
          key={s.id}
          className={`rounded-full transition-all duration-300 ${
            i < step ? 'w-6 h-2 bg-accent-primary' :
            i === step ? 'w-6 h-2 bg-accent-glow' :
            'w-2 h-2 bg-surface-border'
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const { createProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [battery, setBattery] = useState(50);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const batteryColor = getBatteryColor(battery);

  function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('Imagen máximo 2MB'); return; }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);
    setError('');
  }

  function validateUsername() {
    const u = username.trim();
    if (u.length < 3) return 'Mínimo 3 caracteres';
    if (!/^[a-z0-9_]+$/i.test(u)) return 'Solo letras, números y _';
    if (u.length > 20) return 'Máximo 20 caracteres';
    return null;
  }

  async function goNext() {
    setError('');

    if (step === 1) {
      const err = validateUsername();
      if (err) { setError(err); return; }
    }

    if (step === STEPS.length - 2) {
      // Final submit
      setLoading(true);
      try {
        let avatarUrl = null;

        // Upload avatar if provided
        if (avatarFile) {
          const formData = new FormData();
          formData.append('avatar', avatarFile);
          try {
            const res = await fetch(
              apiUrl('/users/avatar'),
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${(await import('../lib/supabase')).supabase.auth.getSession().then(r => r.data.session?.access_token)}` },
                body: formData,
              }
            );
            const data = await res.json();
            if (data.url) avatarUrl = data.url;
          } catch { /* avatar upload optional */ }
        }

        await createProfile({
          username: username.trim().toLowerCase(),
          display_name: displayName.trim() || username.trim(),
          bio: bio.trim() || null,
          avatar_url: avatarUrl || (avatarPreview ? null : null),
          initial_battery: battery,
        });
        setStep(s => s + 1);
      } catch (err) {
        setError(err.message || 'Algo salió mal');
      } finally {
        setLoading(false);
      }
      return;
    }

    setStep(s => s + 1);
  }

  function goBack() {
    setError('');
    setStep(s => Math.max(0, s - 1));
  }

  // ── Step renderers ───────────────────────────────────────────
  const renderStep = () => {
    switch (STEPS[step].id) {

      case 'welcome':
        return (
          <div className="text-center animate-scale-in">
            <div className="text-7xl mb-6 animate-pulse-slow">🔋</div>
            <h1 className="font-display text-3xl font-bold text-surface-text mb-3">
              Bienvenido a<br />
              <span className="text-accent-glow">SocialBattery</span>
            </h1>
            <p className="text-surface-muted text-sm leading-relaxed mb-8 max-w-xs mx-auto">
              Comparte tu nivel de energía social del día y queda con personas
              que tienen la misma actitud que tú en este momento.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-8 text-center">
              {[
                { emoji: '⚡', label: 'Actualiza tu batería diaria' },
                { emoji: '👥', label: 'Conéctate con amigos' },
                { emoji: '📍', label: 'Organiza quedadas' },
              ].map(({ emoji, label }) => (
                <div key={label} className="bg-surface-card border border-surface-border rounded-2xl p-3">
                  <div className="text-2xl mb-1">{emoji}</div>
                  <div className="text-[11px] text-surface-muted leading-tight">{label}</div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'username':
        return (
          <div className="animate-slide-up">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">👤</div>
              <h2 className="font-display text-2xl font-bold text-surface-text">¿Cómo te llaman?</h2>
              <p className="text-surface-muted text-sm mt-1">Elige tu usuario único y nombre visible</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                  Nombre de usuario *
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-muted font-mono text-sm">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase())}
                    placeholder="tu_nombre"
                    maxLength={20}
                    autoFocus
                    className="w-full bg-surface-bg border border-surface-border rounded-xl pl-8 pr-4 py-3
                      text-surface-text text-sm placeholder-surface-muted focus:outline-none focus:border-accent-primary
                      transition-colors font-mono"
                  />
                </div>
                <p className="text-surface-muted/60 text-xs mt-1">Letras, números y _ · Permanente</p>
              </div>

              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                  Nombre visible (opcional)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Tu nombre real o apodo"
                  maxLength={40}
                  className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3
                    text-surface-text text-sm placeholder-surface-muted focus:outline-none focus:border-accent-primary
                    transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2 uppercase tracking-widest">
                  Bio (opcional)
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Cuéntanos algo sobre ti... 🙂"
                  maxLength={160}
                  rows={2}
                  className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3
                    text-surface-text text-sm placeholder-surface-muted focus:outline-none focus:border-accent-primary
                    transition-colors resize-none leading-relaxed"
                />
                <p className="text-right text-xs text-surface-muted/60 mt-1">{bio.length}/160</p>
              </div>
            </div>
          </div>
        );

      case 'avatar':
        return (
          <div className="animate-slide-up text-center">
            <div className="text-5xl mb-3">📸</div>
            <h2 className="font-display text-2xl font-bold text-surface-text mb-1">Pon una foto</h2>
            <p className="text-surface-muted text-sm mb-6">Opcional — puedes añadirla después</p>

            <div className="flex flex-col items-center gap-4">
              {/* Avatar preview */}
              <button
                onClick={() => fileRef.current?.click()}
                className="relative group"
              >
                <div
                  className="w-28 h-28 rounded-full border-2 border-dashed border-accent-primary/40
                    flex items-center justify-center overflow-hidden transition-all
                    group-hover:border-accent-primary group-active:scale-95"
                  style={avatarPreview ? {} : { background: 'var(--sb-card)' }}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-3xl">
                        {(displayName || username)?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-accent-primary text-white w-8 h-8
                  rounded-full flex items-center justify-center text-sm font-bold
                  border-2 border-surface-bg shadow-lg">
                  +
                </div>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />

              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="bg-accent-primary/15 text-accent-glow border border-accent-primary/30
                    rounded-xl px-4 py-2 text-sm font-display font-semibold hover:bg-accent-primary/25 transition-all"
                >
                  {avatarPreview ? 'Cambiar foto' : 'Subir foto'}
                </button>
                {avatarPreview && (
                  <button
                    onClick={() => { setAvatarPreview(null); setAvatarFile(null); }}
                    className="bg-surface-card border border-surface-border rounded-xl px-4 py-2
                      text-sm text-surface-muted hover:text-surface-text transition-all"
                  >
                    Quitar
                  </button>
                )}
              </div>

              <p className="text-xs text-surface-muted/60">JPG, PNG · Máx. 2MB</p>
            </div>
          </div>
        );

      case 'battery':
        return (
          <div className="animate-slide-up">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3" style={{ filter: `drop-shadow(0 0 12px ${batteryColor.hex})` }}>⚡</div>
              <h2 className="font-display text-2xl font-bold text-surface-text">¿Cuánta energía tienes hoy?</h2>
              <p className="text-surface-muted text-sm mt-1">Tu batería social refleja tus ganas de socializar</p>
            </div>

            {/* Big battery display */}
            <div className="text-center mb-6">
              <div
                className="font-display text-7xl font-bold transition-all duration-200"
                style={{ color: batteryColor.hex, textShadow: `0 0 40px ${batteryColor.hex}50` }}
              >
                {battery}
              </div>
              <div className="font-display text-xl text-surface-muted">%</div>
              <div className="font-mono text-sm mt-1" style={{ color: batteryColor.hex }}>
                {batteryColor.label}
              </div>
            </div>

            {/* Slider */}
            <div className="px-2">
              <input
                type="range"
                min={0} max={100}
                value={battery}
                onChange={e => setBattery(Number(e.target.value))}
                className="w-full h-3 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, ${batteryColor.hex} ${battery}%, var(--sb-border) ${battery}%)`,
                  accentColor: batteryColor.hex,
                }}
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs font-mono" style={{ color: 'var(--battery-dead)' }}>😴 0</span>
                <span className="text-xs font-mono text-surface-muted">50</span>
                <span className="text-xs font-mono" style={{ color: 'var(--battery-full)' }}>100 🤩</span>
              </div>
            </div>

            {/* Descriptive tips */}
            <div className="mt-6 bg-surface-card border border-surface-border rounded-2xl p-4">
              <p className="text-xs text-surface-muted leading-relaxed">
                💡 Tus amigos verán este número. Actualízalo cada día para que sepan
                si tienes ganas de quedar o prefieres estar tranquilo.
              </p>
            </div>
          </div>
        );

      case 'done':
        return (
          <div className="text-center animate-scale-in">
            <div className="text-7xl mb-6">🎉</div>
            <h2 className="font-display text-3xl font-bold text-surface-text mb-2">
              ¡Todo listo, <span className="text-accent-glow">@{username}</span>!
            </h2>
            <p className="text-surface-muted text-sm mb-8">
              Tu perfil está creado. Ahora añade amigos y empieza a sincronizar energías.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-8 text-left">
              {[
                { emoji: '👥', title: 'Añade amigos', desc: 'Busca por username' },
                { emoji: '⚡', title: 'Actualiza tu batería', desc: 'Cada día al entrar' },
                { emoji: '📍', title: 'Crea un pool', desc: 'Propón una quedada' },
                { emoji: '🏅', title: 'Gana insignias', desc: 'Por tus hábitos sociales' },
              ].map(({ emoji, title, desc }) => (
                <div key={title} className="bg-surface-card border border-surface-border rounded-2xl p-3">
                  <div className="text-xl mb-1">{emoji}</div>
                  <div className="font-display font-semibold text-surface-text text-xs">{title}</div>
                  <div className="text-[11px] text-surface-muted">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        );

      default: return null;
    }
  };

  const isLastStep = step === STEPS.length - 1;
  const isSubmitStep = step === STEPS.length - 2;

  return (
    <div className="min-h-screen bg-surface-bg flex items-start justify-center p-4 noise">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-primary/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-64 h-64 bg-green-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-sm w-full mt-8">
        <ProgressDots step={step} />

        <div className="bg-surface-card border border-surface-border rounded-3xl p-6 min-h-[400px] flex flex-col">
          <div className="flex-1">{renderStep()}</div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-4 animate-slide-up">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 mt-4">
            {step > 0 && !isLastStep && (
              <button
                onClick={goBack}
                className="flex-1 border border-surface-border rounded-xl py-3 text-surface-muted
                  font-display font-semibold text-sm hover:text-surface-text hover:border-surface-muted transition-all"
              >
                ← Atrás
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={() => navigate('/')}
                className="flex-1 bg-accent-primary hover:bg-accent-primary/80 text-white
                  font-display font-semibold py-3 rounded-xl transition-all duration-200
                  hover:shadow-lg hover:shadow-accent-primary/20"
              >
                Ir al inicio 🚀
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={loading}
                className="flex-1 bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50
                  text-white font-display font-semibold py-3 rounded-xl transition-all duration-200
                  hover:shadow-lg hover:shadow-accent-primary/20"
              >
                {loading ? 'Creando...' : isSubmitStep ? '¡Empezar! 🚀' : 'Continuar →'}
              </button>
            )}
          </div>

          {/* Skip avatar */}
          {STEPS[step].id === 'avatar' && (
            <button
              onClick={goNext}
              className="mt-2 text-center text-xs text-surface-muted hover:text-surface-text transition-colors py-1"
            >
              Saltar por ahora →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
