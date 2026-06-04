import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// ── helpers ──────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function bubbleRgba(hex, opacity) {
  return opacity < 1 ? hexToRgba(hex, opacity) : hex;
}

// ── Accordion wrapper ─────────────────────────────────────────────────────────

function AccordionSection({ id, open, onToggle, icon, title, subtitle, children }) {
  return (
    <div className={`rounded-2xl border transition-colors overflow-hidden ${
      open ? 'border-accent-primary/40 bg-surface-card' : 'border-surface-border bg-surface-card'
    }`}>
      {/* Header */}
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
      >
        <span className="text-xl flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`font-display font-bold text-sm transition-colors ${
            open ? 'text-accent-glow' : 'text-surface-text'
          }`}>
            {title}
          </div>
          {subtitle && (
            <div className="text-xs text-surface-muted mt-0.5">{subtitle}</div>
          )}
        </div>
        <span className={`text-surface-muted transition-transform duration-200 text-sm flex-shrink-0 ${
          open ? 'rotate-180' : ''
        }`}>
          ▾
        </span>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-surface-border animate-slide-down">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Sub-section label inside an accordion ────────────────────────────────────

function SubSection({ title, children }) {
  return (
    <div className="px-4 py-4 space-y-3 border-b border-surface-border last:border-b-0">
      <div className="text-[11px] font-mono uppercase tracking-widest text-surface-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Wallpaper picker ──────────────────────────────────────────────────────────

function WallpaperPicker({ wallpaper, onSet, onClear }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSet(dataUrl);
    } catch {}
    finally { setLoading(false); e.target.value = ''; }
  }

  return (
    <div className="space-y-3">
      {wallpaper ? (
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-xl border border-surface-border bg-cover bg-center flex-shrink-0"
            style={{ backgroundImage: `url(${wallpaper})` }}
          />
          <div className="flex flex-col gap-1.5 flex-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-sm font-display font-semibold text-accent-glow hover:opacity-75 transition-opacity text-left"
            >
              Cambiar imagen
            </button>
            <button
              onClick={onClear}
              className="text-sm font-display font-semibold text-red-400 hover:opacity-75 transition-opacity text-left"
            >
              Quitar fondo
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-surface-border hover:border-accent-primary/50 hover:bg-accent-primary/5 transition-all text-sm text-surface-muted font-display font-semibold"
        >
          <span className="text-base">🖼️</span>
          {loading ? 'Cargando...' : 'Elegir imagen de la galería'}
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ── Bubble colour + opacity + text color row ──────────────────────────────────

function BubbleColorPicker({ label, color, opacity, textColor, onColorChange, onOpacityChange, onTextColorChange }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-display font-semibold text-surface-text">{label}</div>
      <div className="flex items-center gap-3">
        {/* Swatch preview */}
        <div
          className="w-9 h-9 rounded-xl border border-surface-border flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: bubbleRgba(color, opacity), color: textColor }}
        >
          Aa
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-muted w-16">Color</span>
            <input
              type="color"
              value={color}
              onChange={e => onColorChange(e.target.value)}
              className="h-7 flex-1 rounded-lg cursor-pointer bg-transparent border border-surface-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-muted w-16">Opacidad</span>
            <input
              type="range" min="0.3" max="1" step="0.05"
              value={opacity}
              onChange={e => onOpacityChange(parseFloat(e.target.value))}
              className="flex-1 accent-accent-primary"
            />
            <span className="text-xs text-surface-muted font-mono w-8 text-right">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-muted w-16">Letra</span>
            <input
              type="color"
              value={textColor}
              onChange={e => onTextColorChange(e.target.value)}
              className="h-7 flex-1 rounded-lg cursor-pointer bg-transparent border border-surface-border"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tick colour picker ────────────────────────────────────────────────────────

function TickColorPicker({ label, description, color, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-display font-semibold text-surface-text">{label}</div>
        {description && <div className="text-xs text-surface-muted">{description}</div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Swatch preview with double tick */}
        <span style={{ color }} className="inline-flex items-center">
          <svg width="16" height="9" viewBox="0 0 16 9" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 4.5L8.8 7.5L14.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <input
          type="color"
          value={color}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-16 rounded-lg cursor-pointer bg-transparent border border-surface-border"
        />
      </div>
    </div>
  );
}

// ── Live preview ──────────────────────────────────────────────────────────────

function ChatPreview({ wallpaper, myBubbleColor, myBubbleOpacity, myBubbleTextColor, otherBubbleColor, otherBubbleOpacity, otherBubbleTextColor, tickColorSent, tickColorUnread, tickColorRead }) {
  const myStyle = { backgroundColor: bubbleRgba(myBubbleColor, myBubbleOpacity), color: myBubbleTextColor };
  const otherStyle = { backgroundColor: bubbleRgba(otherBubbleColor, otherBubbleOpacity), color: otherBubbleTextColor };

  const TickSingle = ({ color }) => (
    <span style={{ color }} className="inline-flex items-center ml-1 opacity-80">
      <svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );

  const TickDouble = ({ colorOverride }) => (
    <span style={{ color: colorOverride }} className="inline-flex items-center ml-1">
      <svg width="16" height="9" viewBox="0 0 16 9" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6 4.5L8.8 7.5L14.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );

  return (
    <div
      className="rounded-xl overflow-hidden min-h-[140px] p-3 space-y-2 bg-cover bg-center"
      style={wallpaper
        ? { backgroundImage: `url(${wallpaper})` }
        : { backgroundColor: 'var(--sb-bg)' }
      }
    >
      <div className="flex">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs border border-surface-border"
          style={otherStyle}
        >
          ¡Hola! ¿Cómo estás? 👋
        </div>
      </div>
      <div className="flex flex-row-reverse">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs"
          style={myStyle}
        >
          <span>¡Ahora mismo te escribo! <span className="sb-symbol" aria-hidden="true">✎</span></span>
          <div className="flex items-center justify-end gap-0.5 opacity-70 mt-0.5">
            <span className="text-[10px]">12:33</span>
            <TickSingle color={tickColorSent} />
          </div>
        </div>
      </div>
      <div className="flex flex-row-reverse">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs"
          style={myStyle}
        >
          <span>¡Todo genial! 🔋</span>
          <div className="flex items-center justify-end gap-0.5 opacity-70 mt-0.5">
            <span className="text-[10px]">12:34</span>
            <TickDouble colorOverride={tickColorUnread} />
          </div>
        </div>
      </div>
      <div className="flex">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs border border-surface-border"
          style={otherStyle}
        >
          ¿Quedamos este finde? 🤝
        </div>
      </div>
      <div className="flex flex-row-reverse">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs"
          style={myStyle}
        >
          <span>¡Claro que sí! 🎉</span>
          <div className="flex items-center justify-end gap-0.5 opacity-70 mt-0.5">
            <span className="text-[10px]">12:35</span>
            <TickDouble colorOverride={tickColorRead} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Simple info row ───────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-surface-text">{label}</span>
      <span className="text-sm text-surface-muted font-mono">{value}</span>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        flexShrink: 0,
        position: 'relative',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: enabled ? 'var(--sb-accent)' : 'var(--sb-border)',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          transition: 'transform 0.2s',
          transform: enabled ? 'translateX(18px)' : 'translateX(0px)',
          display: 'block',
        }}
      />
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const { theme, isDark, isAurora, isSunset, isForest, isLight, setTheme } = useTheme();
  const { signOut, updatePassword } = useAuth();
  const { showToast } = useToast();
  const {
    chatWallpaper, setChatWallpaper,
    myBubbleColor, setMyBubbleColor,
    myBubbleOpacity, setMyBubbleOpacity,
    myBubbleTextColor, setMyBubbleTextColor,
    otherBubbleColor, setOtherBubbleColor,
    otherBubbleOpacity, setOtherBubbleOpacity,
    otherBubbleTextColor, setOtherBubbleTextColor,
    tickColorUnread, setTickColorUnread,
    tickColorRead, setTickColorRead,
    tickColorSent, setTickColorSent,
    applyMessagingThemeDefaults,
    resetMessagingDefaults,
    muteBatteryChanges, setMuteBatteryChanges,
    muteAllNotifications, setMuteAllNotifications,
    mutePersonalChats, setMutePersonalChats,
    muteGroupChats, setMuteGroupChats,
    muteNewEvents, setMuteNewEvents,
    muteNewPools, setMuteNewPools,
    muteEventReminders, setMuteEventReminders,
    mutePoolReminders, setMutePoolReminders,
    muteEventRecommendations, setMuteEventRecommendations,
    readReceipts, setReadReceipts,
    showOnline, setShowOnline,
    showLastSeen, setShowLastSeen,
  } = useSettings();

  // Only one section open at a time
  const [openSection, setOpenSection] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  function toggleSection(id) {
    setOpenSection(prev => prev === id ? null : id);
  }

  function selectTheme(nextTheme) {
    setTheme(nextTheme);
    applyMessagingThemeDefaults(nextTheme);
    setResetConfirm(false);
  }

  function handleReset() {
    if (resetConfirm) {
      resetMessagingDefaults(theme);
      setResetConfirm(false);
    } else {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
    }
  }

  function setPasswordField(key, value) {
    setPasswordForm(prev => ({ ...prev, [key]: value }));
    setPasswordError('');
  }

  async function handlePasswordChange() {
    if (passwordForm.password.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (passwordForm.password !== passwordForm.confirm) {
      setPasswordError('Las contraseñas no coinciden.');
      return;
    }

    setSavingPassword(true);
    setPasswordError('');
    try {
      await updatePassword(passwordForm.password);
      setPasswordForm({ password: '', confirm: '' });
      showToast('Contraseña actualizada', 'success');
    } catch (e) {
      setPasswordError(e.message || 'No se pudo cambiar la contraseña.');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
      showToast('Sesión cerrada', 'success');
      navigate('/auth', { replace: true });
    } catch (e) {
      showToast(e.message || 'No se pudo cerrar sesión', 'error');
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-bg">
      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg"
          >
            ←
          </button>
          <span className="font-display font-bold text-surface-text text-base">Ajustes</span>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">

        {/* ── PERSONALIZACIÓN ────────────────────────────────────────────── */}
        <AccordionSection
          id="personalizacion"
          open={openSection === 'personalizacion'}
          onToggle={toggleSection}
          icon="🎨"
          title="Personalización"
          subtitle="Tema, fondos y colores de mensajes"
        >
          {/* Temas */}
          <SubSection title="Temas">
            <div className="grid grid-cols-2 gap-2">

              {/* ── Claro ── */}
              <button
                onClick={() => selectTheme('light')}
                className={`relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all ${
                  isLight
                    ? 'border-accent-primary shadow-lg shadow-accent-primary/20'
                    : 'border-surface-border hover:border-surface-muted'
                }`}
              >
                {/* Mini preview */}
                <div className="h-16 w-full flex flex-col gap-1 p-2" style={{ background: '#f4fbfb' }}>
                  <div className="flex gap-1 items-center">
                    <div className="w-3 h-3 rounded-full" style={{ background: '#d8eeee' }} />
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: '#d8eeee' }} />
                  </div>
                  <div className="self-end w-2/3 h-1.5 rounded-full" style={{ background: '#c9f3f3' }} />
                  <div className="self-start w-1/2 h-1.5 rounded-full" style={{ background: '#d8eeee' }} />
                  <div className="self-end w-1/3 h-1.5 rounded-full" style={{ background: '#c9f3f3' }} />
                </div>
                <div className="px-2 py-1.5 flex items-center gap-1" style={{ background: '#ffffff', borderTop: '1px solid #d8eeee' }}>
                  <span className="sb-symbol text-xs" style={{ color: '#00949e' }}>☼</span>
                  <span className="text-xs font-display font-bold" style={{ color: '#1a1a2e' }}>Claro</span>
                  {isLight && <span className="ml-auto text-[10px]" style={{ color: '#00949e' }}>✓</span>}
                </div>
              </button>

              {/* ── Oscuro ── */}
              <button
                onClick={() => selectTheme('dark')}
                className={`relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all ${
                  theme === 'dark'
                    ? 'border-accent-primary shadow-lg shadow-accent-primary/20'
                    : 'border-surface-border hover:border-surface-muted'
                }`}
              >
                <div className="h-16 w-full flex flex-col gap-1 p-2" style={{ background: '#0a0a0f' }}>
                  <div className="flex gap-1 items-center">
                    <div className="w-3 h-3 rounded-full" style={{ background: '#1e1e2e' }} />
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: '#1e1e2e' }} />
                  </div>
                  <div className="self-end w-2/3 h-1.5 rounded-full" style={{ background: '#00949e' }} />
                  <div className="self-start w-1/2 h-1.5 rounded-full" style={{ background: '#1e1e2e' }} />
                  <div className="self-end w-1/3 h-1.5 rounded-full" style={{ background: '#00949e' }} />
                </div>
                <div className="px-2 py-1.5 flex items-center gap-1" style={{ background: '#13131a', borderTop: '1px solid #1e1e2e' }}>
                  <span className="sb-symbol text-xs" style={{ color: '#2dd4dc' }}>☾</span>
                  <span className="text-xs font-display font-bold" style={{ color: '#e2e8f0' }}>Oscuro</span>
                  {theme === 'dark' && <span className="ml-auto text-[10px]" style={{ color: '#2dd4dc' }}>✓</span>}
                </div>
              </button>

            </div>

            {/* ── Otros ── */}
            <div className="mt-3">
              <div className="text-[11px] font-mono uppercase tracking-widest text-surface-muted mb-2">Otros</div>
              <div className="grid grid-cols-2 gap-2">

                {/* ── Aurora ── */}
                <button
                  onClick={() => selectTheme('aurora')}
                  className={`relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all ${
                    isAurora
                      ? 'border-[#dc5078] shadow-lg shadow-[#dc5078]/25'
                      : 'border-surface-border hover:border-surface-muted'
                  }`}
                >
                  <div className="h-16 w-full flex flex-col gap-1 p-2" style={{ background: '#0e0b1a' }}>
                    <div className="flex gap-1 items-center">
                      <div className="w-3 h-3 rounded-full" style={{ background: '#2d2450' }} />
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: '#2d2450' }} />
                    </div>
                    <div className="self-end w-2/3 h-1.5 rounded-full" style={{ background: '#dc5078' }} />
                    <div className="self-start w-1/2 h-1.5 rounded-full" style={{ background: '#2d2450' }} />
                    <div className="self-end w-1/3 h-1.5 rounded-full" style={{ background: '#dc5078' }} />
                  </div>
                  <div className="px-2 py-1.5 flex items-center gap-1" style={{ background: '#16122a', borderTop: '1px solid #2d2450' }}>
                    <span className="text-xs">✦</span>
                    <span className="text-xs font-display font-bold" style={{ color: '#f0e6ff' }}>Aurora</span>
                    {isAurora && <span className="ml-auto text-[10px]" style={{ color: '#ff82a0' }}>✓</span>}
                  </div>
                </button>

                {/* ── Sunset ── */}
                <button
                  onClick={() => selectTheme('sunset')}
                  className={`relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all ${
                    isSunset
                      ? 'border-[#ea781e] shadow-lg shadow-[#ea781e]/25'
                      : 'border-surface-border hover:border-surface-muted'
                  }`}
                >
                  <div className="h-16 w-full flex flex-col gap-1 p-2" style={{ background: '#0f0a05' }}>
                    <div className="flex gap-1 items-center">
                      <div className="w-3 h-3 rounded-full" style={{ background: '#3d2410' }} />
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: '#3d2410' }} />
                    </div>
                    <div className="self-end w-2/3 h-1.5 rounded-full" style={{ background: '#ea781e' }} />
                    <div className="self-start w-1/2 h-1.5 rounded-full" style={{ background: '#3d2410' }} />
                    <div className="self-end w-1/3 h-1.5 rounded-full" style={{ background: '#ffb450' }} />
                  </div>
                  <div className="px-2 py-1.5 flex items-center gap-1" style={{ background: '#1a1008', borderTop: '1px solid #3d2410' }}>
                    <span className="text-xs">🌅</span>
                    <span className="text-xs font-display font-bold" style={{ color: '#fff3e0' }}>Sunset</span>
                    {isSunset && <span className="ml-auto text-[10px]" style={{ color: '#ffb450' }}>✓</span>}
                  </div>
                </button>

                {/* ── Forest ── */}
                <button
                  onClick={() => selectTheme('forest')}
                  className={`relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all ${
                    isForest
                      ? 'border-[#226e36] shadow-lg shadow-[#226e36]/25'
                      : 'border-surface-border hover:border-surface-muted'
                  }`}
                >
                  <div className="h-16 w-full flex flex-col gap-1 p-2" style={{ background: '#f2f7f2' }}>
                    <div className="flex gap-1 items-center">
                      <div className="w-3 h-3 rounded-full" style={{ background: '#c8dfc8' }} />
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: '#c8dfc8' }} />
                    </div>
                    <div className="self-end w-2/3 h-1.5 rounded-full" style={{ background: '#226e36' }} />
                    <div className="self-start w-1/2 h-1.5 rounded-full" style={{ background: '#c8dfc8' }} />
                    <div className="self-end w-1/3 h-1.5 rounded-full" style={{ background: '#226e36' }} />
                  </div>
                  <div className="px-2 py-1.5 flex items-center gap-1" style={{ background: '#ffffff', borderTop: '1px solid #c8dfc8' }}>
                    <span className="text-xs">🌿</span>
                    <span className="text-xs font-display font-bold" style={{ color: '#1a2e1a' }}>Bosque</span>
                    {isForest && <span className="ml-auto text-[10px]" style={{ color: '#226e36' }}>✓</span>}
                  </div>
                </button>

              </div>
            </div>
          </SubSection>

          {/* Fondo de pantalla */}
          <SubSection title="Mensajería · Fondo de pantalla">
            <p className="text-xs text-surface-muted -mt-1 mb-2">
              Se aplica a todos los chats personales. Para grupos, usa el botón 🖼️ dentro de cada chat.
            </p>
            <WallpaperPicker
              wallpaper={chatWallpaper}
              onSet={setChatWallpaper}
              onClear={() => setChatWallpaper(null)}
            />
          </SubSection>

          {/* Colores de mensajes */}
          <SubSection title="Mensajería · Mensajes">
            <div className="space-y-4">
              <BubbleColorPicker
                label="Mis mensajes"
                color={myBubbleColor}
                opacity={myBubbleOpacity}
                textColor={myBubbleTextColor}
                onColorChange={setMyBubbleColor}
                onOpacityChange={setMyBubbleOpacity}
                onTextColorChange={setMyBubbleTextColor}
              />
              <BubbleColorPicker
                label="Mensajes recibidos"
                color={otherBubbleColor}
                opacity={otherBubbleOpacity}
                textColor={otherBubbleTextColor}
                onColorChange={setOtherBubbleColor}
                onOpacityChange={setOtherBubbleOpacity}
                onTextColorChange={setOtherBubbleTextColor}
              />

              {/* Botón restaurar */}
              <button
                onClick={handleReset}
                className={`w-full py-2.5 rounded-xl border text-sm font-display font-semibold transition-all ${
                  resetConfirm
                    ? 'bg-red-500/20 border-red-500/60 text-red-400'
                    : 'bg-surface-bg border-surface-border text-surface-muted hover:border-surface-muted hover:text-surface-text'
                }`}
              >
                {resetConfirm ? '⚠️ Pulsa de nuevo para confirmar' : '↩ Restaurar colores por defecto'}
              </button>
            </div>
          </SubSection>

          {/* Confirmaciones de lectura (ticks) */}
          <SubSection title="Mensajería · Ticks de lectura">
            <p className="text-xs text-surface-muted -mt-1 mb-3">
              Personaliza el color de los ticks que indican el estado de tus mensajes.
            </p>
            <div className="space-y-3">
              <TickColorPicker
                label="Tick enviado"
                description="Tick individual — mensaje enviado (no entregado aún)"
                color={tickColorSent}
                onChange={setTickColorSent}
              />
              <TickColorPicker
                label="Tick enviado / recibido"
                description="Doble tick gris — mensaje entregado"
                color={tickColorUnread}
                onChange={setTickColorUnread}
              />
              <TickColorPicker
                label="Tick de leído"
                description="Doble tick — confirmación de lectura"
                color={tickColorRead}
                onChange={setTickColorRead}
              />
            </div>
          </SubSection>

          {/* Vista previa */}
          <SubSection title="Vista previa">
            <ChatPreview
              wallpaper={chatWallpaper}
              myBubbleColor={myBubbleColor}
              myBubbleOpacity={myBubbleOpacity}
              myBubbleTextColor={myBubbleTextColor}
              otherBubbleColor={otherBubbleColor}
              otherBubbleOpacity={otherBubbleOpacity}
              otherBubbleTextColor={otherBubbleTextColor}
              tickColorSent={tickColorSent}
              tickColorUnread={tickColorUnread}
              tickColorRead={tickColorRead}
            />
          </SubSection>
        </AccordionSection>

        {/* ── PRIVACIDAD ─────────────────────────────────────────────────── */}
        <AccordionSection
          id="privacidad"
          open={openSection === 'privacidad'}
          onToggle={toggleSection}
          icon="🔒"
          title="Privacidad"
          subtitle="Visibilidad de tu perfil y actividad"
        >
          <SubSection title="Visibilidad">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">Mostrar en línea</div>
                  <div className="text-xs text-surface-muted">
                    {showOnline
                      ? 'Tus amigos pueden ver cuando estás activo ahora mismo'
                      : 'Apareces como desconectado — tampoco verás el estado de otros'}
                  </div>
                </div>
                <Toggle enabled={showOnline} onToggle={() => setShowOnline(!showOnline)} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">Mostrar última vez de actualización de batería</div>
                  <div className="text-xs text-surface-muted">
                    {showLastSeen
                      ? 'Se muestra cuándo fue la última vez que tú y tus amigos actualizaron su batería'
                      : 'La fecha de última actualización de batería queda oculta para todos'}
                  </div>
                </div>
                <Toggle enabled={showLastSeen} onToggle={() => setShowLastSeen(!showLastSeen)} />
              </div>

              <div className="border-t border-surface-border" />

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">
                    Confirmación de lectura
                  </div>
                  <div className="text-xs text-surface-muted">
                    {readReceipts
                      ? 'Los demás ven cuándo lees sus mensajes (✓✓ en color) y tú ves los suyos'
                      : 'No se envía confirmación de lectura — tampoco recibirás la de otros'}
                  </div>
                </div>
                <Toggle
                  enabled={readReceipts}
                  onToggle={() => setReadReceipts(!readReceipts)}
                />
              </div>
            </div>
          </SubSection>
        </AccordionSection>

        {/* ── NOTIFICACIONES ─────────────────────────────────────────────── */}
        <AccordionSection
          id="notificaciones"
          open={openSection === 'notificaciones'}
          onToggle={toggleSection}
          icon="🔔"
          title="Notificaciones"
          subtitle="Mensajes, eventos, quedadas y alertas"
        >
          <SubSection title="General">
            <div className="space-y-4">

              {/* Silenciar todas */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">
                    Silenciar notificaciones
                  </div>
                  <div className="text-xs text-surface-muted">
                    Desactiva todas las notificaciones del sistema
                  </div>
                </div>
                <Toggle
                  enabled={muteAllNotifications}
                  onToggle={() => setMuteAllNotifications(!muteAllNotifications)}
                />
              </div>

              {/* Sub-toggles — solo visibles si las notifs del sistema están activadas */}
              {!muteAllNotifications && (
                <div className="pl-4 border-l-2 border-surface-border space-y-4 animate-slide-down">

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar chats personales
                      </div>
                      <div className="text-xs text-surface-muted">
                        No recibirás notificaciones de mensajes directos
                      </div>
                    </div>
                    <Toggle
                      enabled={mutePersonalChats}
                      onToggle={() => setMutePersonalChats(!mutePersonalChats)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar grupos privados
                      </div>
                      <div className="text-xs text-surface-muted">
                        No recibirás notificaciones de grupos
                      </div>
                    </div>
                    <Toggle
                      enabled={muteGroupChats}
                      onToggle={() => setMuteGroupChats(!muteGroupChats)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar nuevos eventos
                      </div>
                      <div className="text-xs text-surface-muted">
                        No te avisaremos cuando se cree un nuevo evento en tus comunidades
                      </div>
                    </div>
                    <Toggle
                      enabled={muteNewEvents}
                      onToggle={() => setMuteNewEvents(!muteNewEvents)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar recomendaciones de eventos
                      </div>
                      <div className="text-xs text-surface-muted">
                        No recibirás notificaciones de eventos premium y destacados
                      </div>
                    </div>
                    <Toggle
                      enabled={muteEventRecommendations}
                      onToggle={() => setMuteEventRecommendations(!muteEventRecommendations)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar nuevas quedadas
                      </div>
                      <div className="text-xs text-surface-muted">
                        No te avisaremos cuando alguien proponga una nueva quedada
                      </div>
                    </div>
                    <Toggle
                      enabled={muteNewPools}
                      onToggle={() => setMuteNewPools(!muteNewPools)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-display font-semibold text-surface-text">
                        Silenciar cambios de batería
                      </div>
                      <div className="text-xs text-surface-muted">
                        No te avisaremos cuando un amigo actualice su energía
                      </div>
                    </div>
                    <Toggle
                      enabled={muteBatteryChanges}
                      onToggle={() => setMuteBatteryChanges(!muteBatteryChanges)}
                    />
                  </div>

                </div>
              )}

              <div className="border-t border-surface-border" />

              {/* Recordatorios */}
              <div className="text-[11px] font-mono uppercase tracking-widest text-surface-muted pt-1">
                Recordatorios
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-display font-semibold text-surface-text">
                      Silenciar avisos de eventos
                    </div>
                    <div className="text-xs text-surface-muted">
                      No recibirás recordatorios de eventos en tu planificación
                    </div>
                  </div>
                  <Toggle
                    enabled={muteAllNotifications || muteEventReminders}
                    onToggle={() => !muteAllNotifications && setMuteEventReminders(!muteEventReminders)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-display font-semibold text-surface-text">
                      Silenciar avisos de quedadas
                    </div>
                    <div className="text-xs text-surface-muted">
                      No recibirás recordatorios de quedadas a las que te has unido
                    </div>
                  </div>
                  <Toggle
                    enabled={muteAllNotifications || mutePoolReminders}
                    onToggle={() => !muteAllNotifications && setMutePoolReminders(!mutePoolReminders)}
                  />
                </div>
              </div>

            </div>
          </SubSection>
        </AccordionSection>

        {/* ── CUENTA ─────────────────────────────────────────────────────── */}
        <AccordionSection
          id="cuenta"
          open={openSection === 'cuenta'}
          onToggle={toggleSection}
          icon="👤"
          title="Cuenta"
          subtitle="Perfil, sesión y datos"
        >
          <SubSection title="Seguridad">
            <div className="space-y-3">
              <input
                type="password"
                value={passwordForm.password}
                onChange={e => setPasswordField('password', e.target.value)}
                placeholder="Nueva contraseña"
                autoComplete="new-password"
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
              <input
                type="password"
                value={passwordForm.confirm}
                onChange={e => setPasswordField('confirm', e.target.value)}
                placeholder="Repetir contraseña"
                autoComplete="new-password"
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
              {passwordError && (
                <p className="text-xs text-red-400 font-mono bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                  {passwordError}
                </p>
              )}
              <button
                onClick={handlePasswordChange}
                disabled={savingPassword || !passwordForm.password || !passwordForm.confirm}
                className="w-full py-2.5 rounded-xl bg-accent-primary/10 border border-accent-primary/20 text-sm font-display font-semibold text-accent-glow hover:bg-accent-primary/20 transition-colors disabled:opacity-50"
              >
                {savingPassword ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </div>
          </SubSection>

          <SubSection title="Sesión">
            <div className="space-y-1">
              <InfoRow label="Versión" value="Phase 8" />
            </div>
            <button
              onClick={() => navigate('/profile')}
              className="mt-3 w-full py-2.5 rounded-xl bg-accent-primary/10 border border-accent-primary/20 text-sm font-display font-semibold text-accent-glow hover:bg-accent-primary/20 transition-colors"
            >
              Editar perfil
            </button>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-3 w-full py-2.5 rounded-xl border border-red-500/25 text-sm font-display font-semibold text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {loggingOut ? 'Cerrando...' : 'Cerrar sesión'}
            </button>
          </SubSection>
        </AccordionSection>

      </div>
    </div>
  );
}
