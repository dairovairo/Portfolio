import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';

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

// ── Bubble colour + opacity row ───────────────────────────────────────────────

function BubbleColorPicker({ label, color, opacity, onColorChange, onOpacityChange }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-display font-semibold text-surface-text">{label}</div>
      <div className="flex items-center gap-3">
        {/* Swatch preview */}
        <div
          className="w-9 h-9 rounded-xl border border-surface-border flex-shrink-0"
          style={{ backgroundColor: bubbleRgba(color, opacity) }}
        />
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
        </div>
      </div>
    </div>
  );
}

// ── Live preview ──────────────────────────────────────────────────────────────

function ChatPreview({ wallpaper, myBubbleColor, myBubbleOpacity, otherBubbleColor, otherBubbleOpacity }) {
  return (
    <div
      className="rounded-xl overflow-hidden min-h-[120px] p-3 space-y-2 bg-cover bg-center"
      style={wallpaper
        ? { backgroundImage: `url(${wallpaper})` }
        : { backgroundColor: 'var(--sb-bg)' }
      }
    >
      <div className="flex">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs text-surface-text border border-surface-border"
          style={{ backgroundColor: bubbleRgba(otherBubbleColor, otherBubbleOpacity) }}
        >
          ¡Hola! ¿Cómo estás? 👋
        </div>
      </div>
      <div className="flex flex-row-reverse">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs text-white"
          style={{ backgroundColor: bubbleRgba(myBubbleColor, myBubbleOpacity) }}
        >
          ¡Todo genial! 🔋
        </div>
      </div>
      <div className="flex">
        <div
          className="max-w-[75%] rounded-2xl px-3 py-2 text-xs text-surface-text border border-surface-border"
          style={{ backgroundColor: bubbleRgba(otherBubbleColor, otherBubbleOpacity) }}
        >
          ¿Quedamos este finde? 🤝
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
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        enabled ? 'bg-accent-primary' : 'bg-surface-border'
      }`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
        enabled ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const { isDark, toggle: toggleTheme } = useTheme();
  const {
    chatWallpaper, setChatWallpaper,
    myBubbleColor, setMyBubbleColor,
    myBubbleOpacity, setMyBubbleOpacity,
    otherBubbleColor, setOtherBubbleColor,
    otherBubbleOpacity, setOtherBubbleOpacity,
  } = useSettings();

  // Only one section open at a time
  const [openSection, setOpenSection] = useState(null);

  function toggleSection(id) {
    setOpenSection(prev => prev === id ? null : id);
  }

  // Local privacy toggles (UI only — extend with real logic as needed)
  const [showBattery, setShowBattery] = useState(true);
  const [showOnline, setShowOnline] = useState(true);
  const [showLastSeen, setShowLastSeen] = useState(true);

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
            <div className="flex gap-2">
              <button
                onClick={() => { if (isDark) toggleTheme(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-display font-semibold transition-all ${
                  !isDark
                    ? 'bg-accent-primary/20 border-accent-primary text-accent-glow'
                    : 'bg-surface-bg border-surface-border text-surface-muted hover:border-surface-muted'
                }`}
              >
                ☀️ Claro
              </button>
              <button
                onClick={() => { if (!isDark) toggleTheme(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-display font-semibold transition-all ${
                  isDark
                    ? 'bg-accent-primary/20 border-accent-primary text-accent-glow'
                    : 'bg-surface-bg border-surface-border text-surface-muted hover:border-surface-muted'
                }`}
              >
                🌙 Oscuro
              </button>
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
                onColorChange={setMyBubbleColor}
                onOpacityChange={setMyBubbleOpacity}
              />
              <BubbleColorPicker
                label="Mensajes recibidos"
                color={otherBubbleColor}
                opacity={otherBubbleOpacity}
                onColorChange={setOtherBubbleColor}
                onOpacityChange={setOtherBubbleOpacity}
              />
            </div>
          </SubSection>

          {/* Vista previa */}
          <SubSection title="Vista previa">
            <ChatPreview
              wallpaper={chatWallpaper}
              myBubbleColor={myBubbleColor}
              myBubbleOpacity={myBubbleOpacity}
              otherBubbleColor={otherBubbleColor}
              otherBubbleOpacity={otherBubbleOpacity}
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
                  <div className="text-sm font-display font-semibold text-surface-text">Mostrar batería</div>
                  <div className="text-xs text-surface-muted">Tus amigos pueden ver tu nivel de batería social</div>
                </div>
                <Toggle enabled={showBattery} onToggle={() => setShowBattery(v => !v)} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">Mostrar en línea</div>
                  <div className="text-xs text-surface-muted">Otros pueden ver cuando estás activo</div>
                </div>
                <Toggle enabled={showOnline} onToggle={() => setShowOnline(v => !v)} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-display font-semibold text-surface-text">Mostrar última vez</div>
                  <div className="text-xs text-surface-muted">Visible en chats privados</div>
                </div>
                <Toggle enabled={showLastSeen} onToggle={() => setShowLastSeen(v => !v)} />
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
          subtitle="Mensajes, quedadas y solicitudes"
        >
          <SubSection title="General">
            <div className="space-y-1">
              <InfoRow label="Notificaciones push" value="Activadas" />
              <InfoRow label="Sonidos" value="Activados" />
              <InfoRow label="Vibración" value="Activada" />
            </div>
            <p className="text-xs text-surface-muted mt-2">
              Gestiona los permisos detallados desde los ajustes de tu dispositivo.
            </p>
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
          </SubSection>
        </AccordionSection>

      </div>
    </div>
  );
}
