import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTutorial } from '../context/TutorialContext';
import { api } from '../lib/api';

// ── Categorías compartidas con Comunidades y Eventos ─────────────────────────
export const ALL_INTERESTS = [
  { id: 'Música',       emoji: '🎵' },
  { id: 'Deporte',      emoji: '⚽' },
  { id: 'Arte',         emoji: '🎨' },
  { id: 'Tecnología',   emoji: '💻' },
  { id: 'Comida',       emoji: '🍽️' },
  { id: 'Viajes',       emoji: '✈️' },
  { id: 'Cine',         emoji: '🎬' },
  { id: 'Juego',        emoji: '🎮' },
  { id: 'Yoga',         emoji: '🧘' },
  { id: 'Fotografía',   emoji: '📷' },
  { id: 'Lectura',      emoji: '📚' },
  { id: 'Naturaleza',   emoji: '🌿' },
  { id: 'Fiesta',       emoji: '🎉' },
  { id: 'Bienestar',    emoji: '💆' },
  { id: 'Cocina',       emoji: '👨‍🍳' },
];

const STEPS = [
  { id: 'welcome',   label: '¡Hola!' },
  { id: 'username',  label: 'Tu nombre' },
  { id: 'interests', label: 'Intereses' },
  { id: 'avatar',    label: 'Tu foto' },
  { id: 'done',      label: '¡Listo!' },
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
  const { completeOnboarding, refreshProfile, signOut } = useAuth();
  const { startTutorial } = useTutorial();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState([]);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

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

  function toggleInterest(id) {
    setInterests(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function validateUsername() {
    const u = username.trim();
    if (u.length < 3) return 'Mínimo 3 caracteres';
    if (!/^[a-z0-9_]+$/i.test(u)) return 'Solo letras, números y _';
    if (u.length > 16) return 'Máximo 16 caracteres';
    return null;
  }

  // Index of the avatar step (submit happens there)
  const avatarStepIdx = STEPS.findIndex(s => s.id === 'avatar');
  const doneStepIdx   = STEPS.findIndex(s => s.id === 'done');

  async function goNext() {
    setError('');

    if (STEPS[step].id === 'username') {
      const err = validateUsername();
      if (err) { setError(err); return; }
    }

    if (step === avatarStepIdx) {
      // Final submit
      setLoading(true);
      try {
        let avatarUrl = null;

        if (avatarFile) {
          const formData = new FormData();
          formData.append('avatar', avatarFile);
          try {
            const data = await api.postForm('/users/avatar', formData);
            if (data.url) avatarUrl = data.url;
          } catch { /* avatar upload optional */ }
        }

        const profilePayload = {
          username: username.trim().toLowerCase(),
          display_name: displayName.trim() || username.trim(),
          bio: bio.trim() || null,
          avatar_url: avatarUrl || null,
          initial_battery: 50,
          interests: interests,
        };

        try {
          await completeOnboarding(profilePayload);
        } catch (submitError) {
          try {
            await refreshProfile();
          } catch {
            throw submitError;
          }
        }

        startTutorial();
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

  // ── Step renderers ───────────────────────────────────────
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
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, '_'))}
                    placeholder="tu_nombre"
                    maxLength={16}
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
                  placeholder="Tu nombre o apodo"
                  maxLength={20}
                  className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3
                    text-surface-text text-sm placeholder-surface-muted focus:outline-none focus:border-accent-primary
                    transition-colors"
                />
                <p className="text-surface-muted/60 text-xs mt-1">Puede tener espacios · Máx. 20 caracteres</p>
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

      case 'interests':
        return (
          <div className="animate-slide-up">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">✨</div>
              <h2 className="font-display text-2xl font-bold text-surface-text">¿Qué te gusta?</h2>
              <p className="text-surface-muted text-sm mt-1">
                Elige tus categorías favoritas — aparecerán en tu perfil
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {ALL_INTERESTS.map(({ id, emoji }) => {
                const selected = interests.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleInterest(id)}
                    className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 border transition-all duration-200
                      ${selected
                        ? 'bg-accent-primary/20 border-accent-primary text-accent-glow shadow-sm shadow-accent-primary/20'
                        : 'bg-surface-bg border-surface-border text-surface-muted hover:border-surface-muted'
                      }`}
                  >
                    <span className="text-2xl">{emoji}</span>
                    <span className={`text-[11px] font-display font-semibold leading-tight text-center ${selected ? 'text-accent-glow' : 'text-surface-muted'}`}>
                      {id}
                    </span>
                    {selected && (
                      <span className="text-[9px] text-accent-primary font-mono">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {interests.length > 0 && (
              <p className="text-center text-xs text-accent-glow mt-3 font-mono">
                {interests.length} seleccionado{interests.length !== 1 ? 's' : ''}
              </p>
            )}
            {interests.length === 0 && (
              <p className="text-center text-xs text-surface-muted/60 mt-3">
                Puedes saltarte este paso y añadirlos después
              </p>
            )}
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

  const isLastStep   = step === STEPS.length - 1;
  const isSubmitStep = step === avatarStepIdx;

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

        </div>

        {/* Escape hatch */}
        <div className="text-center mt-4">
          <button
            onClick={async () => { await signOut(); navigate('/auth', { replace: true }); }}
            className="text-xs text-surface-muted/50 hover:text-surface-muted transition-colors underline underline-offset-4"
          >
            ← Volver a inicio de sesión
          </button>
        </div>
      </div>
    </div>
  );
}
