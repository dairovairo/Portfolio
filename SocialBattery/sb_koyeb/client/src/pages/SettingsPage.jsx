import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';

// ── helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-mono uppercase tracking-widest text-surface-muted px-1">
        {title}
      </h2>
      <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden divide-y divide-surface-border">
        {children}
      </div>
    </div>
  );
}

function Row({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-display font-semibold text-surface-text">{label}</div>
        {description && (
          <div className="text-xs text-surface-muted mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Bubble colour picker row ─────────────────────────────────────────────────

function BubbleColorRow({ label, description, color, opacity, onColorChange, onOpacityChange }) {
  return (
    <div className="px-4 py-3.5 space-y-3">
      <div>
        <div className="text-sm font-display font-semibold text-surface-text">{label}</div>
        {description && (
          <div className="text-xs text-surface-muted mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Preview swatch */}
        <div
          className="w-10 h-10 rounded-xl border-2 border-surface-border flex-shrink-0 shadow-inner"
          style={{ backgroundColor: color, opacity }}
        />
        {/* Color input */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-surface-muted w-12">Color</label>
            <input
              type="color"
              value={color}
              onChange={e => onColorChange(e.target.value)}
              className="h-8 w-full rounded-lg cursor-pointer bg-transparent border border-surface-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-surface-muted w-12">Opacidad</label>
            <input
              type="range"
              min="0.3"
              max="1"
              step="0.05"
              value={opacity}
              onChange={e => onOpacityChange(parseFloat(e.target.value))}
              className="flex-1 accent-accent-primary"
            />
            <span className="text-xs text-surface-muted w-8 text-right font-mono">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Wallpaper picker row ─────────────────────────────────────────────────────

function WallpaperRow({ wallpaper, onSet, onClear }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSet(dataUrl);
    } catch { /* silently ignore */ }
    finally { setLoading(false); e.target.value = ''; }
  }

  return (
    <div className="px-4 py-3.5 space-y-3">
      <div>
        <div className="text-sm font-display font-semibold text-surface-text">Fondo de pantalla</div>
        <div className="text-xs text-surface-muted mt-0.5">
          Imagen de fondo para todos los chats personales
        </div>
      </div>

      {wallpaper ? (
        <div className="flex items-center gap-3">
          <div
            className="w-16 h-16 rounded-xl border border-surface-border bg-cover bg-center flex-shrink-0"
            style={{ backgroundImage: `url(${wallpaper})` }}
          />
          <div className="flex flex-col gap-2 flex-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-sm font-display font-semibold text-accent-glow hover:opacity-80 transition-opacity text-left"
            >
              Cambiar imagen
            </button>
            <button
              onClick={onClear}
              className="text-sm font-display font-semibold text-red-400 hover:opacity-80 transition-opacity text-left"
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
          <span className="text-lg">🖼️</span>
          {loading ? 'Cargando...' : 'Elegir imagen de la galería'}
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme, isDark } = useTheme();
  const {
    chatWallpaper, setChatWallpaper,
    myBubbleColor, setMyBubbleColor,
    myBubbleOpacity, setMyBubbleOpacity,
    otherBubbleColor, setOtherBubbleColor,
    otherBubbleOpacity, setOtherBubbleOpacity,
  } = useSettings();

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

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ── PERSONALIZACIÓN ── */}
        <Section title="Personalización">

          {/* Temas */}
          <div className="px-4 py-3.5 space-y-2">
            <div className="text-sm font-display font-semibold text-surface-text">Temas</div>
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
          </div>

        </Section>

        {/* ── MENSAJERÍA ── */}
        <Section title="Mensajería">

          {/* Wallpaper */}
          <WallpaperRow
            wallpaper={chatWallpaper}
            onSet={setChatWallpaper}
            onClear={() => setChatWallpaper(null)}
          />

          {/* My bubble */}
          <BubbleColorRow
            label="Color de mis mensajes"
            description="Fondo de las burbujas que tú envías"
            color={myBubbleColor}
            opacity={myBubbleOpacity}
            onColorChange={setMyBubbleColor}
            onOpacityChange={setMyBubbleOpacity}
          />

          {/* Other bubble */}
          <BubbleColorRow
            label="Color de mensajes recibidos"
            description="Fondo de las burbujas de los demás"
            color={otherBubbleColor}
            opacity={otherBubbleOpacity}
            onColorChange={setOtherBubbleColor}
            onOpacityChange={setOtherBubbleOpacity}
          />

        </Section>

        {/* Preview mini */}
        <Section title="Vista previa">
          <div
            className="p-4 space-y-2 min-h-[140px] bg-cover bg-center relative"
            style={chatWallpaper ? { backgroundImage: `url(${chatWallpaper})` } : {}}
          >
            {!chatWallpaper && (
              <div className="absolute inset-0 bg-surface-bg rounded-b-2xl" />
            )}
            <div className="relative space-y-2">
              {/* Other bubble */}
              <div className="flex gap-2">
                <div
                  className="max-w-[72%] rounded-2xl px-4 py-2.5 text-sm"
                  style={{
                    backgroundColor: otherBubbleOpacity < 1
                      ? `rgba(${parseInt(otherBubbleColor.slice(1,3),16)},${parseInt(otherBubbleColor.slice(3,5),16)},${parseInt(otherBubbleColor.slice(5,7),16)},${otherBubbleOpacity})`
                      : otherBubbleColor,
                    color: 'var(--sb-text)',
                    border: '1px solid var(--sb-border)',
                  }}
                >
                  ¡Hola! ¿Cómo estás? 👋
                </div>
              </div>
              {/* My bubble */}
              <div className="flex gap-2 flex-row-reverse">
                <div
                  className="max-w-[72%] rounded-2xl px-4 py-2.5 text-sm text-white"
                  style={{
                    backgroundColor: myBubbleOpacity < 1
                      ? `rgba(${parseInt(myBubbleColor.slice(1,3),16)},${parseInt(myBubbleColor.slice(3,5),16)},${parseInt(myBubbleColor.slice(5,7),16)},${myBubbleOpacity})`
                      : myBubbleColor,
                  }}
                >
                  ¡Todo genial! 🔋
                </div>
              </div>
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}
