import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import ItemColorEditorPage from '../components/ItemColorEditorPage';
import MyCustomizationsModal from '../components/MyCustomizationsModal';
import HeadCustomizationsModal from '../components/HeadCustomizationsModal';
import { MASCOT_ACTIVITIES, MASCOT_ACCESSORIES, MASCOT_OUTFITS, MASCOT_FEET, MASCOT_HEAD, useMascot } from '../context/MascotContext';
import { getEffectiveBatteryLevel } from '../lib/battery';

// Monedas iniciales de un usuario nuevo (antes de comprar nada). A partir de
// aquí, el saldo se persiste en localStorage por usuario — ver
// COINS_STORAGE_KEY — para que no se regenere cada vez que se entra a la
// tienda o se reabre la app.
const COINS = 340;
const COINS_STORAGE_KEY = 'sb-shop-coins';

function loadCoins(userId) {
  if (!userId) return COINS;
  try {
    const raw = localStorage.getItem(`${COINS_STORAGE_KEY}_${userId}`);
    if (raw === null) return COINS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : COINS;
  } catch {
    return COINS;
  }
}

function saveCoins(userId, value) {
  if (!userId) return;
  try {
    localStorage.setItem(`${COINS_STORAGE_KEY}_${userId}`, String(value));
  } catch {}
}

function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// ── Tarjeta "Mis personalizaciones" ───────────────────────────────────────────
// Acceso rápido a la galería de prendas con color personalizado (ver
// FeetColorEditorModal/MyCustomizationsModal). Pensada para sentarse al
// lado de la tarjeta "Sin prenda" en un grid de 2 columnas, o como banner
// suelto arriba de un scroll vertical — por eso no fija un ancho propio
// (w-full) y mantiene la misma altura/estructura que el resto de tarjetas.
// renderPreview(item, size) — función opcional para renderizar el preview de
// cada ítem. Si no se pasa, se usa el default de pies (feetSrc).
function MyCustomizationsCard({
  title = 'Mis personalizaciones',
  count,
  previewItems,
  onClick,
  renderPreview,
  previewTier = 'mid',
  singularLabel = 'prenda personalizada',
  pluralLabel = 'prendas personalizadas',
  emptyLabel = 'Aún no has personalizado ninguna prenda',
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-surface-card border border-surface-border rounded-2xl overflow-hidden flex flex-col transition-all duration-200 hover:border-accent-primary/40"
    >
      <div className="relative flex items-center justify-center gap-1 py-4 px-2 bg-surface-hover/30 min-h-[112px]">
        {previewItems.length > 0 ? (
          previewItems.slice(0, 3).map((item, i) => (
            <div
              key={item.id}
              className="rounded-xl overflow-hidden border border-surface-border bg-surface-card flex-shrink-0"
              style={{ marginLeft: i > 0 ? -18 : 0, zIndex: 10 - i }}
            >
              {renderPreview ? renderPreview(item, 64) : (
                <MascotDisplay
                  tier={previewTier}
                  size={64}
                  feetSrc={item.src}
                  feetItemId={item.id}
                  feetOffsetY={item.offsetY ?? null}
                  feetOffsetX={item.offsetX ?? null}
                  feetScale={item.scale ?? null}
                  outfitSrc={null}
                  headSrc={null}
                  accessories={[]}
                  activityLayers={[]}
                />
              )}
            </div>
          ))
        ) : (
          <span className="text-3xl opacity-60" style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
        )}
      </div>

      <div className="px-3 pt-2 pb-3 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{title}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">
          {count > 0
            ? `${count} ${count === 1 ? singularLabel : pluralLabel}`
            : emptyLabel}
        </div>
      </div>
    </button>
  );
}

// ── Tarjeta genérica de item con preview de mascota ───────────────────────────
function ItemCard({ isUnlocked, isActive, canAfford, price, isBase, onBuy, onEquip, children }) {
  return (
    <div className={`bg-surface-card border rounded-2xl overflow-hidden flex flex-col transition-all duration-200
      ${isActive
        ? 'border-accent-primary shadow-md shadow-accent-primary/20'
        : isUnlocked
          ? 'border-surface-border hover:border-accent-primary/40'
          : 'border-surface-border hover:border-surface-muted/40'
      }`}
    >
      {children}

      {/* Acción */}
      <div className="px-3 pb-3 pt-1">
        {isBase || isUnlocked ? (
          isActive ? (
            isBase ? (
              <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
                ✓ Equipado
              </div>
            ) : (
              <button
                onClick={onEquip}
                className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2 hover:bg-accent-primary/20 transition-all"
              >
                ✓ Equipado (quitar)
              </button>
            )
          ) : (
            <button
              onClick={onEquip}
              className="w-full py-2 rounded-xl text-xs font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Equipar
            </button>
          )
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white hover:shadow-md hover:shadow-accent-primary/20'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de ACTIVIDAD ──────────────────────────────────────────────────────
function ActivityCard({ activity, isUnlocked, isActive, canAfford, onBuy, onEquip, previewTier = 'mid' }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={activity.price}
      isBase={activity.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + actividad encima */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Activa
          </span>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          activityLayers={activity.layers}
          accessories={[]}
          outfitSrc={null}
          feetSrc={null}
          headSrc={null}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{activity.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{activity.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{activity.desc}</div>
      </div>
    </ItemCard>
  );
}

// ── Tarjeta de ACCESORIO ──────────────────────────────────────────────────────
// Los accesorios admiten selección múltiple simultánea: cada tarjeta se activa
// o desactiva de forma independiente (como un interruptor), sin afectar a los
// demás accesorios ya equipados.
function AccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onToggle, onCustomize, isCustomized, previewTier = 'mid' }) {
  return (
    <div className={`bg-surface-card border rounded-2xl overflow-hidden flex flex-col transition-all duration-200
      ${isActive
        ? 'border-accent-primary shadow-md shadow-accent-primary/20'
        : isUnlocked
          ? 'border-surface-border hover:border-accent-primary/40'
          : 'border-surface-border hover:border-surface-muted/40'
      }`}
    >
      {/* Preview: mascota base + accesorio en capa 5 */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Activo
          </span>
        )}
        {accessory.src && onCustomize && (
          <button
            onClick={(e) => { e.stopPropagation(); onCustomize(); }}
            title="Personalizar colores"
            className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-surface-card/90 border-2 border-white/90 text-sm hover:border-accent-primary/70 hover:bg-surface-hover transition-all"
          >
            <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
            {isCustomized && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-glow" />
            )}
          </button>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          accessories={accessory.src ? [accessory] : []}
          outfitSrc={null}
          feetSrc={null}
          headSrc={null}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{accessory.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{accessory.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{accessory.desc}</div>
      </div>

      {/* Acción — los accesorios se pueden combinar, así que el botón
          siempre alterna (encender/apagar) en vez de "equipar de forma
          exclusiva" como el resto de categorías. */}
      <div className="px-3 pb-3 pt-1">
        {accessory.isBase ? (
          <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
            ✓ Por defecto
          </div>
        ) : isUnlocked ? (
          <button
            onClick={onToggle}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all
              ${isActive
                ? 'bg-accent-primary/10 border border-accent-primary/30 text-accent-glow hover:bg-accent-primary/20'
                : 'bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40'
              }`}
          >
            {isActive ? 'Quitar' : 'Equipar'}
          </button>
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white hover:shadow-md hover:shadow-accent-primary/20'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {accessory.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta compacta de ACCESORIO (para los carruseles horizontales de
// cadenas / grillz / gafas de sol) ────────────────────────────────────────────
// Versión reducida de AccessoryCard pensada para el scroll horizontal:
// preview pequeño + nombre + acción, sin descripción larga, ancho fijo.
// El toggle sigue llamando a la misma lógica de MascotContext, que ya se
// encarga de que, dentro de su propio grupo (cadenas, grillz o gafas), solo
// pueda haber un accesorio activo a la vez — al activar uno se desactivan
// automáticamente los demás del mismo carrusel, sin tocar el resto.
function CompactAccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onToggle, previewTier = 'mid' }) {
  return (
    <div
      className={`flex-shrink-0 w-36 bg-surface-card border rounded-xl overflow-hidden flex flex-col transition-all duration-200
        ${isActive
          ? 'border-accent-primary shadow-md shadow-accent-primary/20'
          : isUnlocked
            ? 'border-surface-border hover:border-accent-primary/40'
            : 'border-surface-border hover:border-surface-muted/40'
        }`}
    >
      <div className="relative flex items-center justify-center py-3 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-1 right-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-primary text-white z-10">
            ✓
          </span>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          accessories={accessory.src ? [accessory] : []}
          outfitSrc={null}
          feetSrc={null}
          headSrc={null}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-2 pt-1.5 pb-1.5 flex flex-col gap-1">
        <div className="font-display font-semibold text-surface-text text-[11px] leading-tight text-center truncate" title={accessory.name}>
          {accessory.name}
        </div>
        {accessory.isBase ? (
          isActive ? (
            <div className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5">
              ✓ Por defecto
            </div>
          ) : (
            <button
              onClick={onToggle}
              className="w-full py-1.5 rounded-lg text-[10px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Poner
            </button>
          )
        ) : isUnlocked ? (
          <button
            onClick={onToggle}
            className={`w-full py-1.5 rounded-lg text-[10px] font-display font-semibold transition-all
              ${isActive
                ? 'bg-accent-primary/10 border border-accent-primary/30 text-accent-glow hover:bg-accent-primary/20'
                : 'bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40'
              }`}
          >
            {isActive ? 'Quitar' : 'Poner'}
          </button>
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-1.5 rounded-lg text-[10px] font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {accessory.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de OUTFIT ─────────────────────────────────────────────────────────
function OutfitCard({ outfit, isUnlocked, isActive, canAfford, onBuy, onEquip, onCustomize, isCustomized, previewTier = 'mid' }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={outfit.price}
      isBase={outfit.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + outfit en capa 2 */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Puesto
          </span>
        )}
        {outfit.src && onCustomize && (
          <button
            onClick={(e) => { e.stopPropagation(); onCustomize(); }}
            title="Personalizar colores"
            className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-surface-card/90 border-2 border-white/90 text-sm hover:border-accent-primary/70 hover:bg-surface-hover transition-all"
          >
            <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
            {isCustomized && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-glow" />
            )}
          </button>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          outfitSrc={outfit.src}
          outfitItemId={outfit.id}
          outfitSubcategory={outfit.subcategory}
          outfitItemOffsetY={outfit.offsetY}
          outfitItemScale={outfit.scale}
          accessories={[]}
          feetSrc={null}
          headSrc={null}
          activityLayers={[]}
          outfitOffsetY="20%"
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{outfit.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{outfit.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{outfit.desc}</div>
      </div>
    </ItemCard>
  );
}

// ── Tarjeta compacta de OUTFIT BÁSICO (para el carrusel horizontal) ───────────
// Versión reducida de OutfitCard pensada para el scroll horizontal de
// camisetas/camisas básicas (colores lisos): preview pequeño + nombre +
// acción, sin descripción larga, con ancho fijo para que se vea el scroll.
function BasicOutfitCard({ outfit, isUnlocked, isActive, canAfford, onBuy, onEquip, previewTier = 'mid' }) {
  return (
    <div
      className={`flex-shrink-0 w-36 bg-surface-card border rounded-xl overflow-hidden flex flex-col transition-all duration-200
        ${isActive
          ? 'border-accent-primary shadow-md shadow-accent-primary/20'
          : isUnlocked
            ? 'border-surface-border hover:border-accent-primary/40'
            : 'border-surface-border hover:border-surface-muted/40'
        }`}
    >
      <div className="relative flex items-center justify-center py-3 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-1 right-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-primary text-white z-10">
            ✓
          </span>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          outfitSrc={outfit.src}
          outfitItemId={outfit.id}
          outfitSubcategory={outfit.subcategory}
          outfitItemOffsetY={outfit.offsetY}
          outfitItemScale={outfit.scale}
          accessories={[]}
          feetSrc={null}
          headSrc={null}
          activityLayers={[]}
          outfitOffsetY="20%"
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-2 pt-1.5 pb-1.5 flex flex-col gap-1">
        <div className="font-display font-semibold text-surface-text text-[11px] leading-tight text-center truncate" title={outfit.name}>
          {outfit.name}
        </div>
        {isUnlocked ? (
          isActive ? (
            <button
              onClick={onEquip}
              className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5 hover:bg-accent-primary/20 transition-all"
            >
              Puesto
            </button>
          ) : (
            <button
              onClick={onEquip}
              className="w-full py-1.5 rounded-lg text-[10px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Poner
            </button>
          )
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-1.5 rounded-lg text-[10px] font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {outfit.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta compacta de PIES BÁSICO (para el carrusel horizontal) ─────────────
// Versión reducida de FeetCard pensada para el scroll horizontal de
// colores de la zapatilla retro (misma silueta, distinto color): preview
// pequeño + nombre + acción, sin descripción larga, ancho fijo.
function BasicFeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip, previewTier = 'mid' }) {
  return (
    <div
      className={`flex-shrink-0 w-36 bg-surface-card border rounded-xl overflow-hidden flex flex-col transition-all duration-200
        ${isActive
          ? 'border-accent-primary shadow-md shadow-accent-primary/20'
          : isUnlocked
            ? 'border-surface-border hover:border-accent-primary/40'
            : 'border-surface-border hover:border-surface-muted/40'
        }`}
    >
      <div className="relative flex items-center justify-center py-3 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-1 right-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-primary text-white z-10">
            ✓
          </span>
        )}
        {/* Sin botón de personalización individual aquí: esta tarjeta vive
            siempre dentro de un carrusel horizontal, que ya tiene su propio
            botón "🎨 Personalizar" general en la cabecera. */}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          feetSrc={feet.src}
          feetItemId={feet.id}
          feetOffsetY={feet.offsetY ?? null}
          feetOffsetX={feet.offsetX ?? null}
          feetScale={feet.scale ?? null}
          outfitSrc={null}
          headSrc={null}
          accessories={[]}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-2 pt-1.5 pb-1.5 flex flex-col gap-1">
        <div className="font-display font-semibold text-surface-text text-[11px] leading-tight text-center truncate" title={feet.name}>
          {feet.name}
        </div>
        {isUnlocked ? (
          isActive ? (
            <button
              onClick={onEquip}
              className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5 hover:bg-accent-primary/20 transition-all"
            >
              Puesto
            </button>
          ) : (
            <button
              onClick={onEquip}
              className="w-full py-1.5 rounded-lg text-[10px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Poner
            </button>
          )
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-1.5 rounded-lg text-[10px] font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {feet.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de PIES ───────────────────────────────────────────────────────────
function FeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip, onCustomize, isCustomized, previewTier = 'mid' }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={feet.price}
      isBase={feet.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + calzado */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Puesto
          </span>
        )}
        {/* Botón de personalización extrema de color — uno por cada ítem
            "suelto" de calzado (mocasines, zapatos…), ya que estos no
            pertenecen a ningún carrusel con su propio botón general. No se
            muestra en el ítem "Sin prenda" porque no hay ninguna imagen de
            calzado que recolorear. El contorno blanco (en vez del color de
            borde habitual, demasiado oscuro) es lo que lo hace legible
            encima del preview de la zapatilla. */}
        {feet.src && (
          <button
            onClick={(e) => { e.stopPropagation(); onCustomize(); }}
            title="Personalizar colores"
            className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-surface-card/90 border-2 border-white/90 text-sm hover:border-accent-primary/70 hover:bg-surface-hover transition-all"
          >
            <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
            {isCustomized && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-glow" />
            )}
          </button>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          feetSrc={feet.src}
          feetItemId={feet.id}
          feetOffsetY={feet.offsetY ?? null}
          feetOffsetX={feet.offsetX ?? null}
          feetScale={feet.scale ?? null}
          outfitSrc={null}
          headSrc={null}
          accessories={[]}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{feet.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{feet.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{feet.desc}</div>
      </div>
    </ItemCard>
  );
}

// ── Tarjeta de CABEZA ─────────────────────────────────────────────────────────
function HeadCard({ head, isUnlocked, isActive, canAfford, onBuy, onEquip, onCustomize, isCustomized, previewTier = 'mid' }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={head.price}
      isBase={head.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + prenda de cabeza */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Puesto
          </span>
        )}
        {/* Botón de personalización extrema de color — solo en ítems con
            imagen (no en "Sin prenda"). Mismo diseño que en FeetCard. */}
        {head.src && onCustomize && (
          <button
            onClick={(e) => { e.stopPropagation(); onCustomize(); }}
            title="Personalizar colores"
            className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-surface-card/90 border-2 border-white/90 text-sm hover:border-accent-primary/70 hover:bg-surface-hover transition-all"
          >
            <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
            {isCustomized && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-glow" />
            )}
          </button>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          headSrc={head.src}
          headScale={head.scale}
          headOffsetY={head.offsetY}
          headOffsetX={head.offsetX}
          headBox={head.box}
          outfitSrc={null}
          feetSrc={null}
          accessories={[]}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{head.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{head.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{head.desc}</div>
      </div>
    </ItemCard>
  );
}

// ── Tarjeta compacta de GORRA (para el carrusel horizontal de "Gorras") ──────
// Igual que BasicFeetCard/BasicOutfitCard pero para prendas de cabeza:
// preview pequeño + nombre + acción "Poner/Puesto", sin descripción larga.
function BasicHeadCard({ head, isUnlocked, isActive, canAfford, onBuy, onEquip, previewTier = 'mid' }) {
  return (
    <div
      className={`flex-shrink-0 w-36 bg-surface-card border rounded-xl overflow-hidden flex flex-col transition-all duration-200
        ${isActive
          ? 'border-accent-primary shadow-md shadow-accent-primary/20'
          : isUnlocked
            ? 'border-surface-border hover:border-accent-primary/40'
            : 'border-surface-border hover:border-surface-muted/40'
        }`}
    >
      <div className="relative flex items-center justify-center py-3 px-2 bg-surface-hover/30">
        {isActive && (
          <span className="absolute top-1 right-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-primary text-white z-10">
            ✓
          </span>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier={previewTier}
          size={112}
          headSrc={head.src}
          headScale={head.scale}
          headOffsetY={head.offsetY}
          headOffsetX={head.offsetX}
          headBox={head.box}
          outfitSrc={null}
          feetSrc={null}
          accessories={[]}
          activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      <div className="px-2 pt-1.5 pb-1.5 flex flex-col gap-1">
        <div className="font-display font-semibold text-surface-text text-[11px] leading-tight text-center truncate" title={head.name}>
          {head.name}
        </div>
        {isUnlocked ? (
          isActive ? (
            <button
              onClick={onEquip}
              className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5 hover:bg-accent-primary/20 transition-all"
            >
              Puesto
            </button>
          ) : (
            <button
              onClick={onEquip}
              className="w-full py-1.5 rounded-lg text-[10px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Poner
            </button>
          )
        ) : (
          <button
            onClick={onBuy}
            disabled={!canAfford}
            className={`w-full py-1.5 rounded-lg text-[10px] font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {head.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── ShopPage ──────────────────────────────────────────────────────────────────
export default function ShopPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const {
    unlockedActivities, unlockedAccessories, unlockedOutfits, unlockedFeet, unlockedHead,
    activeActivity, activeAccessories, activeOutfit, activeFeet, activeHead,
    unlockActivity, unlockAccessory, unlockOutfit, unlockFeet, unlockHead,
    equipActivity, toggleAccessory, equipOutfit, equipFeet, equipHead,
    getFeetZones, saveFeetCustomization, removeFeetCustomization, getCustomFeetItems,
    getHeadZones, saveHeadCustomization, removeHeadCustomization, getCustomHeadItems,
    getOutfitZones, saveOutfitCustomization, removeOutfitCustomization, getCustomOutfitItems,
    getAccessoryZones, saveAccessoryCustomization, removeAccessoryCustomization, getCustomAccessoryItems,
    savedOutfits, saveCurrentOutfit, applySavedOutfit, removeSavedOutfit,
  } = useMascot();

  const [tab, setTab]                   = useState('activities');
  const [outfitMainTab, setOutfitMainTab] = useState('torso'); // 'pies' | 'torso' | 'cabeza'
  const [outfitSubTab, setOutfitSubTab] = useState('camiseta'); // 'camiseta' | 'camisa'
  const [coins, setCoins]       = useState(() => loadCoins(profile?.id));
  const [toast, setToast]       = useState(null);

  // Releer el saldo guardado en cuanto se conoce el usuario (profile.id
  // tarda un tick en resolverse tras montar, por la sesión async de
  // Supabase), y guardarlo en cada cambio posterior. Mismo patrón que el
  // "skin" persistente en MascotContext.
  useEffect(() => {
    if (profile?.id) setCoins(loadCoins(profile.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (profile?.id) saveCoins(profile.id, coins);
  }, [coins, profile?.id]);

  // Ítem de calzado que se está personalizando en el editor de color (null
  // = modal cerrado). Se guarda el objeto completo (no solo el id) para
  // poder mostrar su nombre/imagen en el modal directamente. Puede ser:
  //   - un ítem ORIGINAL del catálogo (MASCOT_FEET) → al guardar se CREA una
  //     personalización nueva, sin tocar el original.
  //   - un ítem ya PERSONALIZADO (de feetCustomizations) → al guardar se
  //     ACTUALIZA esa misma personalización (se sigue editando "la misma
  //     prenda personalizada", no se crea una segunda).
  const [editingFeetItem, setEditingFeetItem] = useState(null);
  // Si editingFeetItem es una personalización ya existente, aquí se guarda
  // su id para que el guardado actualice esa entrada en vez de crear una
  // nueva. null = se está creando una personalización nueva.
  const [editingCustomId, setEditingCustomId] = useState(null);
  // Galería "Mis personalizaciones" — true mientras está abierta.
  const [showMyCustomizations, setShowMyCustomizations] = useState(false);

  // ── Estado análogo para gorros personalizados ────────────────────────────────
  // Ítem de cabeza que se está personalizando en el editor de color (null
  // = modal cerrado). Puede ser un ítem original del catálogo (MASCOT_HEAD)
  // o un ítem ya personalizado (headCustomizations).
  const [editingHeadItem,  setEditingHeadItem]  = useState(null);
  // Si editingHeadItem es una personalización ya existente, aquí se guarda
  // su id para que el guardado la actualice en vez de crear una nueva.
  const [editingHeadCustomId, setEditingHeadCustomId] = useState(null);
  // Galería "Gorros personalizados" — true mientras está abierta.
  const [showHeadCustomizations, setShowHeadCustomizations] = useState(false);

  const [editingOutfitItem, setEditingOutfitItem] = useState(null);
  const [editingOutfitCustomId, setEditingOutfitCustomId] = useState(null);
  const [showOutfitCustomizations, setShowOutfitCustomizations] = useState(false);
  const [showSavedOutfits, setShowSavedOutfits] = useState(false);

  const [editingAccessoryItem, setEditingAccessoryItem] = useState(null);
  const [editingAccessoryCustomId, setEditingAccessoryCustomId] = useState(null);
  const [showAccessoryCustomizations, setShowAccessoryCustomizations] = useState(false);

  // Ítems de calzado personalizados: ahora son ítems INDEPENDIENTES (no el
  // modelo original recoloreado), ver getCustomFeetItems en MascotContext.
  // Se recalcula en cada render, así que siempre refleja el último cambio
  // guardado/eliminado.
  const customizedFeetItems = getCustomFeetItems();

  // Ítems de cabeza personalizados — igual que los de pies.
  const customizedHeadItems = getCustomHeadItems();

  const customizedOutfitItems = getCustomOutfitItems();
  const customizedAccessoryItems = getCustomAccessoryItems();
  const customizedOutfitsForSubTab = customizedOutfitItems.filter(o => o.subcategory === outfitSubTab);
  const shopBatteryLevel = profile ? getEffectiveBatteryLevel(profile) : 50;
  const previewTier = getMascotTier(shopBatteryLevel);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function handleSaveCurrentOutfit() {
    if (activeOutfit === 'out_none') {
      showToast('Equipa alguna prenda antes de guardar el outfit');
      return;
    }
    const saved = saveCurrentOutfit();
    setShowSavedOutfits(true);
    showToast(`"${saved.name}" guardado`);
  }

  function handleApplySavedOutfit(outfit) {
    applySavedOutfit(outfit);
    setShowSavedOutfits(false);
    showToast(`"${outfit.name}" aplicado`);
  }

  function handleRemoveSavedOutfit(outfit) {
    removeSavedOutfit(outfit.id);
    showToast(`"${outfit.name}" eliminado`);
  }

  // Botón "🎨 Personalizar" de cada carrusel horizontal: SIEMPRE aplica
  // sobre la variante blanca de la familia (isCustomizeBase), sin importar
  // qué color esté equipado. Así el lienzo de partida es neutro y el color
  // base no interfiere con el color que el usuario quiera pintar.
  function pickCarouselTarget(family) {
    return family.find(f => f.isCustomizeBase) ?? family[0] ?? null;
  }

  // El indicador 🎨 de una tarjeta de calzado original ahora se basa en si
  // existe AL MENOS UNA personalización derivada de ese ítem (por baseId),
  // ya que el id del original nunca aparece directamente en
  // feetCustomizations: cada personalización vive con su propio id
  // `feet_custom_<n>` (ver saveFeetCustomization en MascotContext).
  function hasAnyCustomizationOf(baseId) {
    return customizedFeetItems.some(c => c.baseId === baseId);
  }

  // Abre el editor para crear una personalización NUEVA a partir de un
  // ítem original del catálogo (botón 🎨 en carruseles/tarjetas).
  function handleOpenCustomizeNew(item) {
    setEditingCustomId(null);
    setEditingFeetItem(item);
  }

  // ── Análogos para cabeza ─────────────────────────────────────────────────────

  function hasAnyCustomizationOfHead(baseId) {
    return customizedHeadItems.some(c => c.baseId === baseId);
  }

  // Botón "🎨 Personalizar" de los carruseles de cabeza: SIEMPRE aplica
  // sobre la variante marcada como isCustomizeBase de cada familia, sin
  // importar qué gorra esté equipada (mismo criterio que pies, ver arriba).
  function pickCarouselTargetHead(family) {
    return family.find(h => h.isCustomizeBase) ?? family[0] ?? null;
  }

  function handleOpenCustomizeHeadNew(item) {
    setEditingHeadCustomId(null);
    setEditingHeadItem(item);
  }

  function outfitCustomizationLabels(subcategory = outfitSubTab) {
    return subcategory === 'camisa'
      ? {
          title: 'Camisas personalizadas',
          singular: 'camisa personalizada',
          plural: 'camisas personalizadas',
          empty: 'Aún no has personalizado ninguna camisa',
          saved: 'Camisas personalizadas',
        }
      : {
          title: 'Camisetas personalizadas',
          singular: 'camiseta personalizada',
          plural: 'camisetas personalizadas',
          empty: 'Aún no has personalizado ninguna camiseta',
          saved: 'Camisetas personalizadas',
        };
  }

  function hasAnyCustomizationOfOutfit(baseId) {
    return customizedOutfitItems.some(c => c.baseId === baseId);
  }

  // Botón "🎨 Personalizar" del carrusel "Básicos" de Torso: SIEMPRE aplica
  // sobre la variante marcada como isCustomizeBase de la sub-tab activa
  // (camiseta/camisa), sin importar qué prenda esté equipada.
  function pickCarouselTargetOutfit(family) {
    return family.find(o => o.isCustomizeBase) ?? family[0] ?? null;
  }

  function handleOpenCustomizeOutfitNew(item) {
    if (!item) return;
    setEditingOutfitCustomId(null);
    setEditingOutfitItem(item);
  }

  function handleSaveOutfitColors(zones) {
    const labels = outfitCustomizationLabels(editingOutfitItem?.subcategory);
    const newId = saveOutfitCustomization(editingOutfitItem, zones, editingOutfitCustomId);
    if (newId) showToast(`¡"${editingOutfitItem.baseName ?? editingOutfitItem.name}" guardada en ${labels.saved}! 🎨`);
    setEditingOutfitItem(null);
    setEditingOutfitCustomId(null);
  }

  function handleEditOutfitFromGallery(item) {
    setShowOutfitCustomizations(false);
    setEditingOutfitCustomId(item.id);
    setEditingOutfitItem(item);
  }

  function handleRemoveOutfitCustomization(item) {
    const labels = outfitCustomizationLabels(item.subcategory);
    removeOutfitCustomization(item.id);
    showToast(`"${item.name}" eliminada de ${labels.saved} ✨`);
  }

  function handleEquipCustomOutfit(item) {
    const wasActive = activeOutfit === item.id;
    equipOutfit(item.id);
    showToast(wasActive ? `${item.name} retirada` : `¡${item.name} puesta! ✨`);
  }

  function hasAnyCustomizationOfAccessory(baseId) {
    return customizedAccessoryItems.some(c => c.baseId === baseId);
  }

  // Botón "🎨 Personalizar" de cada carrusel de accesorios: SIEMPRE aplica
  // sobre la variante marcada como isCustomizeBase de esa familia, sin
  // importar qué accesorio esté equipado.
  function pickAccessoryTarget(family) {
    return family.find(a => a.isCustomizeBase) ?? family[0] ?? null;
  }

  function handleOpenCustomizeAccessoryNew(item) {
    if (!item) return;
    setEditingAccessoryCustomId(null);
    setEditingAccessoryItem(item);
  }

  function handleSaveAccessoryColors(zones) {
    const newId = saveAccessoryCustomization(editingAccessoryItem, zones, editingAccessoryCustomId);
    if (newId) showToast(`¡"${editingAccessoryItem.baseName ?? editingAccessoryItem.name}" guardado en Accesorios personalizados! 🎨`);
    setEditingAccessoryItem(null);
    setEditingAccessoryCustomId(null);
  }

  function handleEditAccessoryFromGallery(item) {
    setShowAccessoryCustomizations(false);
    setEditingAccessoryCustomId(item.id);
    setEditingAccessoryItem(item);
  }

  function handleRemoveAccessoryCustomization(item) {
    removeAccessoryCustomization(item.id);
    showToast(`"${item.name}" eliminado de Accesorios personalizados ✨`);
  }

  function handleEquipCustomAccessory(item) {
    const wasActive = activeAccessories.has(item.id);
    toggleAccessory(item.id);
    showToast(wasActive ? `${item.name} retirado` : `¡${item.name} equipado! ✨`);
  }

  function handleSaveHeadColors(zones) {
    const newId = saveHeadCustomization(editingHeadItem, zones, editingHeadCustomId);
    if (newId) showToast(`¡"${editingHeadItem.baseName ?? editingHeadItem.name}" guardada en Gorros personalizados! 🎨`);
    setEditingHeadItem(null);
    setEditingHeadCustomId(null);
  }

  function handleEditHeadFromGallery(item) {
    setShowHeadCustomizations(false);
    setEditingHeadCustomId(item.id);
    setEditingHeadItem(item);
  }

  function handleRemoveHeadCustomization(item) {
    removeHeadCustomization(item.id);
    showToast(`"${item.name}" eliminada de Gorros personalizados ✨`);
  }

  function handleEquipCustomHead(item) {
    const wasActive = activeHead === item.id;
    equipHead(item.id);
    showToast(wasActive ? `${item.name} retirada` : `¡${item.name} puesto! ✨`);
  }

  function handleSaveFeetColors(zones) {
    const newId = saveFeetCustomization(editingFeetItem, zones, editingCustomId);
    if (newId) showToast(`¡"${editingFeetItem.baseName ?? editingFeetItem.name}" guardada en Calzado personalizado! 🎨`);
    setEditingFeetItem(null);
    setEditingCustomId(null);
  }

  // Desde la galería "Mis personalizaciones": reabrir el editor de una
  // personalización ya existente (cerrando la galería primero) — al guardar
  // se actualizará esa misma entrada — o eliminarla sin salir de la galería.
  function handleEditFromGallery(item) {
    setShowMyCustomizations(false);
    setEditingCustomId(item.id);
    setEditingFeetItem(item);
  }
  function handleRemoveCustomization(item) {
    removeFeetCustomization(item.id);
    showToast(`"${item.name}" eliminada de Calzado personalizado ✨`);
  }

  // ── Actividades ─────────────────────────────────────────────────────────────
  function handleBuyActivity(activity) {
    if (coins < activity.price) return;
    setCoins(c => c - activity.price);
    unlockActivity(activity.id);
    equipActivity(activity.id);
    showToast(`¡${activity.name} desbloqueada y equipada! 🎉`);
  }
  function handleEquipActivity(activity) {
    const wasActive = activeActivity === activity.id;
    equipActivity(activity.id);
    showToast(wasActive ? `${activity.name} retirada` : `¡${activity.name} equipada! ✨`);
  }

  // ── Accesorios — selección múltiple: cada uno se enciende/apaga sin
  // afectar a los demás (varios accesorios pueden estar activos a la vez).
  function handleBuyAccessory(accessory) {
    if (coins < accessory.price) return;
    setCoins(c => c - accessory.price);
    unlockAccessory(accessory.id);
    toggleAccessory(accessory.id);
    showToast(`¡${accessory.name} desbloqueado y equipado! 🎉`);
  }
  function handleToggleAccessory(accessory) {
    const wasActive = activeAccessories.has(accessory.id);
    toggleAccessory(accessory.id);
    showToast(wasActive ? `${accessory.name} retirado` : `¡${accessory.name} equipado! ✨`);
  }

  // ── Outfits — Torso ──────────────────────────────────────────────────────────
  function handleBuyOutfit(outfit) {
    if (coins < outfit.price) return;
    setCoins(c => c - outfit.price);
    unlockOutfit(outfit.id);
    equipOutfit(outfit.id);
    showToast(`¡${outfit.name} desbloqueada y puesta! 🎉`);
  }
  function handleEquipOutfit(outfit) {
    const wasActive = activeOutfit === outfit.id;
    equipOutfit(outfit.id);
    showToast(wasActive ? `${outfit.name} retirada` : `¡${outfit.name} puesta! ✨`);
  }

  // ── Outfits — Pies ───────────────────────────────────────────────────────────
  function handleBuyFeet(feet) {
    if (coins < feet.price) return;
    setCoins(c => c - feet.price);
    unlockFeet(feet.id);
    equipFeet(feet.id);
    showToast(`¡${feet.name} desbloqueado y puesto! 🎉`);
  }
  function handleEquipFeet(feet) {
    const wasActive = activeFeet === feet.id;
    equipFeet(feet.id);
    showToast(wasActive ? `${feet.name} retirado` : `¡${feet.name} puesto! ✨`);
  }
  // Equipar una personalización desde la galería "Mis personalizaciones":
  // usa el mismo equipFeet del contexto (acepta cualquier id activo, sea
  // del catálogo o de feetCustomizations — ver getMascotLayers).
  function handleEquipCustomFeet(item) {
    const wasActive = activeFeet === item.id;
    equipFeet(item.id);
    showToast(wasActive ? `${item.name} retirada` : `¡${item.name} puesta! ✨`);
  }

  // ── Outfits — Cabeza ─────────────────────────────────────────────────────────
  function handleBuyHead(head) {
    if (coins < head.price) return;
    setCoins(c => c - head.price);
    unlockHead(head.id);
    equipHead(head.id);
    showToast(`¡${head.name} desbloqueada y puesta! 🎉`);
  }
  function handleEquipHead(head) {
    const wasActive = activeHead === head.id;
    equipHead(head.id);
    showToast(wasActive ? `${head.name} retirada` : `¡${head.name} puesta! ✨`);
  }

  const activeAct  = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
  // El ítem base ("Sin actividad") SÍ se muestra en la tienda, como una
  // tarjeta más al principio del grid (ya es el primer elemento del array
  // MASCOT_ACTIVITIES), a diferencia del resto de ítems base de
  // outfit/accesorios, que siguen excluidos.
  const activityOptions = MASCOT_ACTIVITIES;
  const allShopAccessories = [...MASCOT_ACCESSORIES, ...customizedAccessoryItems];
  const activeAccs = allShopAccessories.filter(a => activeAccessories.has(a.id));
  const activeOut  = MASCOT_OUTFITS.find(o => o.id === activeOutfit) ?? customizedOutfitItems.find(o => o.id === activeOutfit);
  const activeFt   = MASCOT_FEET.find(f => f.id === activeFeet) ?? customizedFeetItems.find(f => f.id === activeFeet);
  const activeHd   = MASCOT_HEAD.find(h => h.id === activeHead) ?? customizedHeadItems.find(h => h.id === activeHead);

  // Outfits (torso) filtrados por sub-tab
  // - baseOutfit: ítem "Sin prenda" de esta sub-tab → botón ResetButton encima
  // - basicOutfits: colores lisos de esa sub-tab → carrusel horizontal
  // - restOutfits: estampados/temáticas de esa sub-tab → grid vertical
  const filteredOutfits = MASCOT_OUTFITS.filter(o => o.subcategory === outfitSubTab);
  const baseOutfit   = filteredOutfits.find(o => o.isBase) ?? null;
  const basicOutfits = filteredOutfits.filter(o => o.isBasic);
  const restOutfits  = filteredOutfits.filter(o => !o.isBasic && !o.isBase);

  // Pies: ítem base ("Sin calzado") → botón ResetButton encima de los
  // carruseles. Retro colores → carrusel. Chunky colores → carrusel.
  // El resto (mocasines, oxford…) → grid vertical.
  const baseFeet   = MASCOT_FEET.find(f => f.isBase) ?? null;
  const basicFeet  = MASCOT_FEET.filter(f => f.isBasic);
  const basicFeet2 = MASCOT_FEET.filter(f => f.isBasic2);
  const restFeet   = MASCOT_FEET.filter(f => !f.isBasic && !f.isBasic2 && !f.isBase);

  // Cabeza: ítem base ("Sin prenda") → botón ResetButton encima de los
  // carruseles. Gorras lisas → carrusel. Gorras bicolor → carrusel.
  // El resto (sombreros, halos…) → grid vertical.
  const baseHead   = MASCOT_HEAD.find(h => h.isBase) ?? null;
  const basicHead  = MASCOT_HEAD.filter(h => h.isBasic);
  const basicHead2 = MASCOT_HEAD.filter(h => h.isBasic2);
  const restHead   = MASCOT_HEAD.filter(h => !h.isBasic && !h.isBasic2 && !h.isBase);

  // Accesorios: el ítem "Sin X" de cada grupo de selección única (gafas,
  // cadenas, grillz, corbatas, pajaritas) se muestra como la primera
  // tarjeta de su propio carrusel (con preview de la mascota sin ese
  // accesorio puesto), no como un botón de reset aparte. La opción general
  // "Sin accesorio" (acc_none) no se muestra en la tienda; "ningún
  // accesorio puesto" ya se representa de forma natural cuando no hay nada
  // activo.
  const baseChain          = MASCOT_ACCESSORIES.find(a => a.isBase && a.isChain) ?? null;
  const baseGrillz         = MASCOT_ACCESSORIES.find(a => a.isBase && a.isGrillz) ?? null;
  const baseGlasses        = MASCOT_ACCESSORIES.find(a => a.isBase && a.isGlasses) ?? null;
  const baseTie            = MASCOT_ACCESSORIES.find(a => a.isBase && a.isTie) ?? null;
  const baseBowTie         = MASCOT_ACCESSORIES.find(a => a.isBase && a.isBowTie) ?? null;
  const chainAccessories   = MASCOT_ACCESSORIES.filter(a => a.isChain && !a.isBase);
  const grillzAccessories  = MASCOT_ACCESSORIES.filter(a => a.isGrillz && !a.isBase);
  const glassesAccessories = MASCOT_ACCESSORIES.filter(a => a.isGlasses && !a.isBase);
  const tieAccessories     = MASCOT_ACCESSORIES.filter(a => a.isTie && !a.isBase);
  const bowTieAccessories  = MASCOT_ACCESSORIES.filter(a => a.isBowTie && !a.isBase);
  const restAccessories    = MASCOT_ACCESSORIES.filter(
    a => !a.isChain && !a.isGrillz && !a.isGlasses && !a.isTie && !a.isBowTie && !a.isBase
  );

  // Una tarjeta "Sin X" de grupo se muestra como activa cuando ningún otro
  // miembro de su mismo grupo está equipado (representa "grupo vacío"; su
  // id nunca se guarda dentro de activeAccessories).
  function isAccessoryCardActive(accessory) {
    if (accessory.isBase) {
      return !allShopAccessories.some(other =>
        other.id !== accessory.id &&
        !other.isBase &&
        (
          (accessory.isChain && other.isChain) ||
          (accessory.isGrillz && other.isGrillz) ||
          (accessory.isGlasses && other.isGlasses) ||
          (accessory.isTie && other.isTie) ||
          (accessory.isBowTie && other.isBowTie)
        ) &&
        activeAccessories.has(other.id)
      );
    }
    return activeAccessories.has(accessory.id);
  }

  const currentOutfitCustomizationLabels = outfitCustomizationLabels();

  function renderOutfitCustomizationPreview(item, size) {
    return (
      <MascotDisplay
        tier={previewTier}
        size={size}
        outfitSrc={item.src}
        outfitItemId={item.id}
        outfitSubcategory={item.subcategory}
        outfitItemOffsetY={item.offsetY ?? null}
        outfitItemScale={item.scale ?? null}
        accessories={[]}
        feetSrc={null}
        headSrc={null}
        activityLayers={[]}
        outfitOffsetY="20%"
      />
    );
  }

  function renderAccessoryCustomizationPreview(item, size) {
    return (
      <MascotDisplay
        tier={previewTier}
        size={size}
        accessories={item.src ? [item] : []}
        outfitSrc={null}
        feetSrc={null}
        headSrc={null}
        activityLayers={[]}
      />
    );
  }

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-primary text-white px-5 py-3
          rounded-2xl text-sm font-display font-semibold shadow-lg shadow-accent-primary/30 animate-slide-down whitespace-nowrap">
          {toast}
        </div>
      )}

      {editingFeetItem && (
        <ItemColorEditorPage
          item={editingFeetItem}
          itemType="feet"
          previewTier={previewTier}
          initialZones={getFeetZones(editingFeetItem.id)}
          onClose={() => { setEditingFeetItem(null); setEditingCustomId(null); }}
          onSave={handleSaveFeetColors}
          helpText="Toca una zona de la zapatilla para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites (suela, cuerpo, cordones…)."
        />
      )}

      {showMyCustomizations && (
        <MyCustomizationsModal
          title="Calzado personalizado"
          items={customizedFeetItems}
          activeFeetId={activeFeet}
          emptyText="Aún no has personalizado ningún calzado. Toca el botón 🎨 de cualquier zapatilla para crear tu propia variante de color."
          singularLabel="calzado personalizado"
          pluralLabel="calzados personalizados"
          onEquip={handleEquipCustomFeet}
          onEdit={handleEditFromGallery}
          onRemove={handleRemoveCustomization}
          onClose={() => setShowMyCustomizations(false)}
          previewTier={previewTier}
        />
      )}

      {editingOutfitItem && (
        <ItemColorEditorPage
          item={editingOutfitItem}
          itemType="outfit"
          previewTier={previewTier}
          initialZones={getOutfitZones(editingOutfitItem.id)}
          onClose={() => { setEditingOutfitItem(null); setEditingOutfitCustomId(null); }}
          onSave={handleSaveOutfitColors}
          helpText={`Toca una zona de la ${editingOutfitItem.subcategory === 'camisa' ? 'camisa' : 'camiseta'} para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites.`}
        />
      )}

      {showOutfitCustomizations && (
        <MyCustomizationsModal
          title={currentOutfitCustomizationLabels.title}
          items={customizedOutfitsForSubTab}
          activeItemId={activeOutfit}
          emptyText={currentOutfitCustomizationLabels.empty}
          singularLabel={currentOutfitCustomizationLabels.singular}
          pluralLabel={currentOutfitCustomizationLabels.plural}
          renderPreview={renderOutfitCustomizationPreview}
          onEquip={handleEquipCustomOutfit}
          onEdit={handleEditOutfitFromGallery}
          onRemove={handleRemoveOutfitCustomization}
          onClose={() => setShowOutfitCustomizations(false)}
          previewTier={previewTier}
        />
      )}

      {editingHeadItem && (
        <ItemColorEditorPage
          item={editingHeadItem}
          itemType="head"
          previewTier={previewTier}
          initialZones={getHeadZones(editingHeadItem.id)}
          onClose={() => { setEditingHeadItem(null); setEditingHeadCustomId(null); }}
          onSave={handleSaveHeadColors}
          helpText="Toca una zona del gorro para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites (copa, visera, logo…)."
        />
      )}

      {showHeadCustomizations && (
        <HeadCustomizationsModal
          items={customizedHeadItems}
          activeHeadId={activeHead}
          onEquip={handleEquipCustomHead}
          onEdit={handleEditHeadFromGallery}
          onRemove={handleRemoveHeadCustomization}
          onClose={() => setShowHeadCustomizations(false)}
          previewTier={previewTier}
        />
      )}

      {editingAccessoryItem && (
        <ItemColorEditorPage
          item={editingAccessoryItem}
          itemType="accessory"
          previewTier={previewTier}
          initialZones={getAccessoryZones(editingAccessoryItem.id)}
          onClose={() => { setEditingAccessoryItem(null); setEditingAccessoryCustomId(null); }}
          onSave={handleSaveAccessoryColors}
          helpText="Toca una zona del accesorio para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites."
        />
      )}

      {showAccessoryCustomizations && (
        <MyCustomizationsModal
          title="Accesorios personalizados"
          items={customizedAccessoryItems}
          activeItemIds={activeAccessories}
          activeLabel="Activo"
          equipLabel="Equipar"
          emptyText="Aún no has personalizado ningún accesorio. Toca el botón 🎨 de cualquier accesorio para crear tu propia variante de color."
          singularLabel="accesorio personalizado"
          pluralLabel="accesorios personalizados"
          renderPreview={renderAccessoryCustomizationPreview}
          onEquip={handleEquipCustomAccessory}
          onEdit={handleEditAccessoryFromGallery}
          onRemove={handleRemoveAccessoryCustomization}
          onClose={() => setShowAccessoryCustomizations(false)}
          previewTier={previewTier}
        />
      )}

      {/* Header — z-20 (por encima del z-10 de las superposiciones de
          items bloqueados/"Puesto" de las tarjetas) para que la flecha de
          volver siga siendo clicable aunque, al hacer scroll, coincida
          visualmente con la superposición de un item no comprado. */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-20">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl text-surface-muted hover:text-surface-text hover:bg-surface-card transition-all"
          >
            ←
          </button>
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xl" style={{ fontVariantEmoji: 'emoji' }}>🛒</span>
            <span className="font-display font-bold text-surface-text">Tienda de la mascota</span>
          </div>
          <div className="flex items-center gap-1.5 bg-surface-card border border-surface-border rounded-xl px-3 py-1.5">
            <span className="text-sm">🪙</span>
            <span className="font-mono font-bold text-accent-glow text-sm">{coins}</span>
          </div>
        </div>
      </nav>

      {/* Preview mascota activa con las 6 capas — se le pasan explícitamente
          todos los valores activos (outfit, pies, cabeza, accesorios) para
          que siempre refleje al instante cualquier cambio hecho en la
          tienda, sin depender de ningún cálculo intermedio. */}
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-4">
          <MascotDisplay
            tier={previewTier}
            size={72}
            outfitSrc={activeOut?.src ?? null}
            outfitItemId={activeOut?.id ?? null}
            outfitSubcategory={activeOut?.subcategory ?? null}
            outfitItemOffsetY={activeOut?.offsetY ?? null}
            outfitItemScale={activeOut?.scale ?? null}
            feetSrc={activeFt?.src ?? null}
            feetItemId={activeFt?.id ?? null}
            feetOffsetY={activeFt?.offsetY ?? null}
            feetOffsetX={activeFt?.offsetX ?? null}
            feetScale={activeFt?.scale ?? null}
            headSrc={activeHd?.src ?? null}
            headItemId={activeHd?.id ?? null}
            headScale={activeHd?.scale ?? null}
            headOffsetY={activeHd?.offsetY ?? null}
            headOffsetX={activeHd?.offsetX ?? null}
            headBox={activeHd?.box ?? null}
            accessories={activeAccs}
            activityLayers={activeAct?.layers ?? []}
          />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="font-display font-bold text-surface-text text-sm">Tu mascota ahora</div>
              <div className="text-[10px] text-surface-muted/60 mt-0.5 leading-tight">
                Ganas 🪙 actualizando<br />tu batería cada día.
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => setShowSavedOutfits(true)}
                className="flex items-center gap-1 text-[10px] font-display font-semibold text-surface-text bg-surface-bg border border-surface-border rounded-lg px-2 py-1 hover:bg-surface-card transition-all whitespace-nowrap"
              >
                <span style={{ fontVariantEmoji: 'emoji' }}>👗</span>
                Tus outfits
              </button>
              <button
                onClick={handleSaveCurrentOutfit}
                disabled={activeOutfit === 'out_none'}
                className="flex items-center gap-1 text-[10px] font-display font-semibold text-surface-text bg-surface-bg border border-surface-border rounded-lg px-2 py-1 hover:bg-surface-card transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-bg"
              >
                <span style={{ fontVariantEmoji: 'emoji' }}>💾</span>
                Guardar outfit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar principal */}
      <div className="max-w-lg mx-auto w-full px-4 py-3">
        <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-1">
          {[
            { key: 'activities',  label: 'Actividades', emoji: '⚡' },
            { key: 'outfit',      label: 'Outfit',      emoji: '👕' },
            { key: 'accessories', label: 'Accesorios',  emoji: '😎' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-display font-semibold transition-all duration-200
                ${tab === t.key
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
                }`}
            >
              <span style={{ fontVariantEmoji: 'emoji' }}>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-lg mx-auto w-full px-4 pb-32 flex-1">

        {/* ── Actividades ── */}
        {tab === 'activities' && (
          <div className="grid grid-cols-2 gap-3">
            {activityOptions.map(activity => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                isUnlocked={unlockedActivities.has(activity.id)}
                isActive={activeActivity === activity.id}
                canAfford={coins >= activity.price}
                onBuy={() => handleBuyActivity(activity)}
                onEquip={() => handleEquipActivity(activity)}
                previewTier={previewTier}
              />
            ))}
          </div>
        )}

        {/* ── Outfit: Pies / Torso / Cabeza ── */}
        {tab === 'outfit' && (
          <div className="flex flex-col gap-3">
            {/* Sub-tabs principales del Outfit */}
            <div className="flex bg-surface-card border border-surface-border rounded-xl p-0.5 gap-0.5">
              {[
                { key: 'pies',   label: 'Pies',   emoji: '👟' },
                { key: 'torso',  label: 'Torso',  emoji: '👕' },
                { key: 'cabeza', label: 'Cabeza', emoji: '🧢' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => setOutfitMainTab(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-display font-semibold transition-all duration-200
                    ${outfitMainTab === s.key
                      ? 'bg-accent-primary text-white shadow-sm'
                      : 'text-surface-muted hover:text-surface-text'
                    }`}
                >
                  <span style={{ fontVariantEmoji: 'emoji' }}>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Sección: Pies */}
            {outfitMainTab === 'pies' && (
              <div>
                {/* Ítem base "Sin prenda" — misma tarjeta con preview de
                    mascota que se usa en Actividades para "Sin actividad",
                    en vez del botón de reset compacto. Sigue colocada
                    encima de los carruseles, ahora junto a la tarjeta de
                    acceso a "Mis personalizaciones" en vez de a ancho
                    completo. */}
                {baseFeet && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <FeetCard
                      feet={baseFeet}
                      isUnlocked={true}
                      isActive={activeFeet === baseFeet.id}
                      canAfford={true}
                      onBuy={() => handleEquipFeet(baseFeet)}
                      onEquip={() => handleEquipFeet(baseFeet)}
                      onCustomize={() => {}}
                      isCustomized={false}
                      previewTier={previewTier}
                    />
                    <MyCustomizationsCard
                      title="Calzado personalizado"
                      count={customizedFeetItems.length}
                      previewItems={customizedFeetItems}
                      singularLabel="calzado personalizado"
                      pluralLabel="calzados personalizados"
                      emptyLabel="Aún no has personalizado ningún calzado"
                      onClick={() => setShowMyCustomizations(true)}
                      previewTier={previewTier}
                    />
                  </div>
                )}

                {/* Carrusel horizontal: colores de la zapatilla retro (misma
                    silueta, distinto color), siempre visible arriba del
                    scroll vertical principal. */}
                {basicFeet.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between px-0.5 mb-1.5">
                      <div className="text-[11px] font-display font-semibold text-surface-muted">
                        Retro · colores
                      </div>
                      <button
                        onClick={() => handleOpenCustomizeNew(pickCarouselTarget(basicFeet))}
                        className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                      >
                        <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                        Personalizar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                      {basicFeet.map(feet => (
                        <BasicFeetCard
                          key={feet.id}
                          feet={feet}
                          isUnlocked={unlockedFeet.has(feet.id)}
                          isActive={activeFeet === feet.id}
                          canAfford={coins >= feet.price}
                          onBuy={() => handleBuyFeet(feet)}
                          onEquip={() => handleEquipFeet(feet)}
                          previewTier={previewTier}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Carrusel horizontal: variaciones de color de la zapatilla
                    chunky (mismo molde voluminoso, distinto color). */}
                {basicFeet2.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between px-0.5 mb-1.5">
                      <div className="text-[11px] font-display font-semibold text-surface-muted">
                        Chunky · colores
                      </div>
                      <button
                        onClick={() => handleOpenCustomizeNew(pickCarouselTarget(basicFeet2))}
                        className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                      >
                        <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                        Personalizar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                      {basicFeet2.map(feet => (
                        <BasicFeetCard
                          key={feet.id}
                          feet={feet}
                          isUnlocked={unlockedFeet.has(feet.id)}
                          isActive={activeFeet === feet.id}
                          canAfford={coins >= feet.price}
                          onBuy={() => handleBuyFeet(feet)}
                          onEquip={() => handleEquipFeet(feet)}
                          previewTier={previewTier}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {restFeet.map(feet => (
                    <FeetCard
                      key={feet.id}
                      feet={feet}
                      isUnlocked={unlockedFeet.has(feet.id)}
                      isActive={activeFeet === feet.id}
                      canAfford={coins >= feet.price}
                      onBuy={() => handleBuyFeet(feet)}
                      onEquip={() => handleEquipFeet(feet)}
                      onCustomize={() => handleOpenCustomizeNew(feet)}
                      isCustomized={hasAnyCustomizationOf(feet.id)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sección: Torso */}
            {outfitMainTab === 'torso' && (
              <div>
                {/* Sub-tabs: Camisetas / Camisas */}
                <div className="flex bg-surface-card border border-surface-border rounded-xl p-0.5 gap-0.5 mb-3">
                  {[
                    { key: 'camiseta', label: 'Camisetas', emoji: '👕' },
                    { key: 'camisa',   label: 'Camisas',   emoji: '👔' },
                  ].map(s => (
                    <button
                      key={s.key}
                      onClick={() => setOutfitSubTab(s.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-display font-semibold transition-all duration-200
                        ${outfitSubTab === s.key
                          ? 'bg-accent-primary text-white shadow-sm'
                          : 'text-surface-muted hover:text-surface-text'
                        }`}
                    >
                      <span style={{ fontVariantEmoji: 'emoji' }}>{s.emoji}</span>
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* Ítem base "Sin prenda" de esta sub-tab — misma tarjeta con
                    preview de mascota que se usa en Actividades para "Sin
                    actividad", en vez del botón de reset compacto. Sigue
                    colocada encima del carrusel y el grid, ahora junto a la
                    tarjeta de acceso a "Mis personalizaciones" en vez de a
                    ancho completo. */}
                {baseOutfit && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <OutfitCard
                      outfit={baseOutfit}
                      isUnlocked={true}
                      isActive={activeOutfit === baseOutfit.id}
                      canAfford={true}
                      onBuy={() => handleEquipOutfit(baseOutfit)}
                      onEquip={() => handleEquipOutfit(baseOutfit)}
                      previewTier={previewTier}
                    />
                    <MyCustomizationsCard
                      title={currentOutfitCustomizationLabels.title}
                      count={customizedOutfitsForSubTab.length}
                      previewItems={customizedOutfitsForSubTab}
                      singularLabel={currentOutfitCustomizationLabels.singular}
                      pluralLabel={currentOutfitCustomizationLabels.plural}
                      emptyLabel={currentOutfitCustomizationLabels.empty}
                      onClick={() => setShowOutfitCustomizations(true)}
                      renderPreview={renderOutfitCustomizationPreview}
                      previewTier={previewTier}
                    />
                  </div>
                )}

                {/* Carrusel horizontal: básicos de colores lisos de esta
                    sub-tab (camisetas o camisas), siempre visible arriba del
                    scroll vertical principal. */}
                {basicOutfits.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between px-0.5 mb-1.5">
                      <div className="text-[11px] font-display font-semibold text-surface-muted">
                        Básicos
                      </div>
                      <button
                        onClick={() => handleOpenCustomizeOutfitNew(pickCarouselTargetOutfit(basicOutfits))}
                        className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                      >
                        <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                        Personalizar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                      {basicOutfits.map(outfit => (
                        <BasicOutfitCard
                          key={outfit.id}
                          outfit={outfit}
                          isUnlocked={unlockedOutfits.has(outfit.id)}
                          isActive={activeOutfit === outfit.id}
                          canAfford={coins >= outfit.price}
                          onBuy={() => handleBuyOutfit(outfit)}
                          onEquip={() => handleEquipOutfit(outfit)}
                          previewTier={previewTier}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {restOutfits.map(outfit => (
                    <OutfitCard
                      key={outfit.id}
                      outfit={outfit}
                      isUnlocked={unlockedOutfits.has(outfit.id)}
                      isActive={activeOutfit === outfit.id}
                      canAfford={coins >= outfit.price}
                      onBuy={() => handleBuyOutfit(outfit)}
                      onEquip={() => handleEquipOutfit(outfit)}
                      onCustomize={() => handleOpenCustomizeOutfitNew(outfit)}
                      isCustomized={hasAnyCustomizationOfOutfit(outfit.id)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sección: Cabeza */}
            {outfitMainTab === 'cabeza' && (
              <div className="flex flex-col gap-4">
                {/* Ítem base "Sin prenda" junto a la tarjeta de acceso a
                    "Gorros personalizados" — misma estructura que en Pies. */}
                {baseHead && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <HeadCard
                      head={baseHead}
                      isUnlocked={true}
                      isActive={activeHead === baseHead.id}
                      canAfford={true}
                      onBuy={() => handleEquipHead(baseHead)}
                      onEquip={() => handleEquipHead(baseHead)}
                      previewTier={previewTier}
                    />
                    <MyCustomizationsCard
                      title="Gorros personalizados"
                      count={customizedHeadItems.length}
                      previewItems={customizedHeadItems}
                      onClick={() => setShowHeadCustomizations(true)}
                      previewTier={previewTier}
                      renderPreview={(item, size) => (
                        <MascotDisplay
                          tier={previewTier}
                          size={size}
                          headSrc={item.src}
                          headItemId={item.id}
                          headScale={item.scale ?? null}
                          headOffsetY={item.offsetY ?? null}
                          headOffsetX={item.offsetX ?? null}
                          headBox={item.box ?? null}
                          outfitSrc={null}
                          feetSrc={null}
                          accessories={[]}
                          activityLayers={[]}
                        />
                      )}
                    />
                  </div>
                )}

                {/* Carrusel: Gorras lisas (basicHead) — con botón 🎨 */}
                {basicHead.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-0.5 mb-1.5">
                      <div className="text-[11px] font-display font-semibold text-surface-muted">
                        Gorras lisas
                      </div>
                      <button
                        onClick={() => handleOpenCustomizeHeadNew(pickCarouselTargetHead(basicHead))}
                        className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                      >
                        <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                        Personalizar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                      {basicHead.map(head => (
                        <BasicHeadCard
                          key={head.id}
                          head={head}
                          isUnlocked={unlockedHead.has(head.id)}
                          isActive={activeHead === head.id}
                          canAfford={coins >= head.price}
                          onBuy={() => handleBuyHead(head)}
                          onEquip={() => handleEquipHead(head)}
                          previewTier={previewTier}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Carrusel: Gorras (basicHead2) — con botón 🎨 */}
                {basicHead2.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-0.5 mb-1.5">
                      <div className="text-[11px] font-display font-semibold text-surface-muted">
                        Gorras
                      </div>
                      <button
                        onClick={() => handleOpenCustomizeHeadNew(pickCarouselTargetHead(basicHead2))}
                        className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                      >
                        <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                        Personalizar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                      {basicHead2.map(head => (
                        <BasicHeadCard
                          key={head.id}
                          head={head}
                          isUnlocked={unlockedHead.has(head.id)}
                          isActive={activeHead === head.id}
                          canAfford={coins >= head.price}
                          onBuy={() => handleBuyHead(head)}
                          onEquip={() => handleEquipHead(head)}
                          previewTier={previewTier}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Grid: ítems sueltos de cabeza (sombreros, halos…)
                    con botón 🎨 individual, igual que FeetCard. Los ítems
                    con noCustomize (sombrero chino, gorro de fiesta, halo de
                    luz) no reciben onCustomize, así que HeadCard no muestra
                    el botón para ellos (ver HeadCard: solo lo pinta si
                    head.src && onCustomize). */}
                <div className="grid grid-cols-2 gap-3">
                  {restHead.map(head => (
                    <HeadCard
                      key={head.id}
                      head={head}
                      isUnlocked={unlockedHead.has(head.id)}
                      isActive={activeHead === head.id}
                      canAfford={coins >= head.price}
                      onBuy={() => handleBuyHead(head)}
                      onEquip={() => handleEquipHead(head)}
                      onCustomize={head.noCustomize ? null : () => handleOpenCustomizeHeadNew(head)}
                      isCustomized={!head.noCustomize && hasAnyCustomizationOfHead(head.id)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Accesorios (selección múltiple: se pueden combinar varios,
            salvo dentro de cadenas/grillz/gafas, que son grupos de
            selección única con su propio carrusel horizontal) ── */}
        {tab === 'accessories' && (
          <div className="flex flex-col gap-4">
            {/* Acceso a la galería "Mis personalizaciones" — arriba del
                todo del scroll vertical, antes de cualquier carrusel. */}
            <MyCustomizationsCard
              title="Accesorios personalizados"
              count={customizedAccessoryItems.length}
              previewItems={customizedAccessoryItems}
              singularLabel="accesorio personalizado"
              pluralLabel="accesorios personalizados"
              emptyLabel="Aún no has personalizado ningún accesorio"
              onClick={() => setShowAccessoryCustomizations(true)}
              renderPreview={renderAccessoryCustomizationPreview}
              previewTier={previewTier}
            />

            {/* Carrusel: Corbatas — elige una. La opción "Sin corbata" va
                como primera tarjeta del propio carrusel (con preview de la
                mascota sin corbata), en vez de un botón de reset aparte. */}
            {tieAccessories.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-0.5 mb-1.5">
                  <div className="text-[11px] font-display font-semibold text-surface-muted">
                    Corbatas · elige una
                  </div>
                  <button
                    onClick={() => handleOpenCustomizeAccessoryNew(pickAccessoryTarget(tieAccessories))}
                    className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                  >
                    <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                    Personalizar
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {[baseTie, ...tieAccessories].filter(Boolean).map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Pajaritas — elige una */}
            {bowTieAccessories.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-0.5 mb-1.5">
                  <div className="text-[11px] font-display font-semibold text-surface-muted">
                    Pajaritas · elige una
                  </div>
                  <button
                    onClick={() => handleOpenCustomizeAccessoryNew(pickAccessoryTarget(bowTieAccessories))}
                    className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                  >
                    <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                    Personalizar
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {[baseBowTie, ...bowTieAccessories].filter(Boolean).map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Cadenas — elige una */}
            {chainAccessories.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-0.5 mb-1.5">
                  <div className="text-[11px] font-display font-semibold text-surface-muted">
                    Cadenas · elige una
                  </div>
                  <button
                    onClick={() => handleOpenCustomizeAccessoryNew(pickAccessoryTarget(chainAccessories))}
                    className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                  >
                    <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                    Personalizar
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {[baseChain, ...chainAccessories].filter(Boolean).map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Grillz — elige uno */}
            {grillzAccessories.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-0.5 mb-1.5">
                  <div className="text-[11px] font-display font-semibold text-surface-muted">
                    Grillz · elige uno
                  </div>
                  <button
                    onClick={() => handleOpenCustomizeAccessoryNew(pickAccessoryTarget(grillzAccessories))}
                    className="text-[10px] font-display font-semibold text-accent-glow bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-2 py-1 hover:bg-accent-primary/20 transition-all flex items-center gap-1"
                  >
                    <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
                    Personalizar
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {[baseGrillz, ...grillzAccessories].filter(Boolean).map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Gafas de sol — elige unas. Sin botón de
                personalización de color (a diferencia de cadenas/grillz/
                corbatas/pajaritas): esta familia no admite recolor. */}
            {glassesAccessories.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-0.5 mb-1.5">
                  <div className="text-[11px] font-display font-semibold text-surface-muted">
                    Gafas de sol · elige unas
                  </div>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {[baseGlasses, ...glassesAccessories].filter(Boolean).map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                      previewTier={previewTier}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Resto de accesorios — selección libre, combinables entre sí
                y con lo elegido en los carruseles de arriba */}
            <div className="grid grid-cols-2 gap-3">
              {restAccessories.map(accessory => (
                <AccessoryCard
                  key={accessory.id}
                  accessory={accessory}
                  isUnlocked={unlockedAccessories.has(accessory.id)}
                  isActive={isAccessoryCardActive(accessory)}
                  canAfford={coins >= accessory.price}
                  onBuy={() => handleBuyAccessory(accessory)}
                  onToggle={() => handleToggleAccessory(accessory)}
                  onCustomize={() => handleOpenCustomizeAccessoryNew(accessory)}
                  isCustomized={hasAnyCustomizationOfAccessory(accessory.id)}
                  previewTier={previewTier}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Tus outfits guardados */}
      {showSavedOutfits && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowSavedOutfits(false)}>
          <div className="bg-surface-card border border-surface-border rounded-t-3xl w-full max-w-lg p-5 pb-8 mb-16 max-h-[65vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header del modal */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg" style={{ fontVariantEmoji: 'emoji' }}>👗</span>
                <span className="font-display font-bold text-surface-text">Tus outfits guardados</span>
              </div>
              <button
                onClick={() => setShowSavedOutfits(false)}
                className="p-1.5 rounded-xl text-surface-muted hover:text-surface-text hover:bg-surface-bg transition-all text-sm"
              >
                ✕
              </button>
            </div>

            {/* Lista de outfits guardados */}
            {savedOutfits.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-center">
                <span className="text-3xl" style={{ fontVariantEmoji: 'emoji' }}>🪆</span>
                <div className="font-display font-semibold text-surface-text text-sm">Aún no hay outfits guardados</div>
                <div className="text-[11px] text-surface-muted max-w-[220px]">
                  Equipa tu look favorito y pulsa «Guardar outfit» para guardarlo aquí.
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
                {savedOutfits.map(outfit => (
                  <div
                    key={outfit.id}
                    className="flex items-center gap-3 bg-surface-bg border border-surface-border rounded-2xl p-3"
                  >
                    {/* Mini preview mascota con ese outfit — resolvemos IDs a ítems */}
                    {(() => {
                      const sOut  = MASCOT_OUTFITS.find(o => o.id === outfit.activeOutfit) ?? customizedOutfitItems.find(o => o.id === outfit.activeOutfit);
                      const sFt   = MASCOT_FEET.find(f => f.id === outfit.activeFeet) ?? customizedFeetItems.find(f => f.id === outfit.activeFeet);
                      const sHd   = MASCOT_HEAD.find(h => h.id === outfit.activeHead) ?? customizedHeadItems.find(h => h.id === outfit.activeHead);
                      const sAccs = allShopAccessories.filter(a => (outfit.activeAccessories ?? []).includes(a.id));
                      return (
                        <MascotDisplay
                          tier={previewTier}
                          size={48}
                          outfitSrc={sOut?.src ?? null}
                          outfitItemId={sOut?.id ?? null}
                          outfitSubcategory={sOut?.subcategory ?? null}
                          outfitItemOffsetY={sOut?.offsetY ?? null}
                          outfitItemScale={sOut?.scale ?? null}
                          feetSrc={sFt?.src ?? null}
                          feetItemId={sFt?.id ?? null}
                          feetOffsetY={sFt?.offsetY ?? null}
                          feetOffsetX={sFt?.offsetX ?? null}
                          feetScale={sFt?.scale ?? null}
                          headSrc={sHd?.src ?? null}
                          headItemId={sHd?.id ?? null}
                          headScale={sHd?.scale ?? null}
                          headOffsetY={sHd?.offsetY ?? null}
                          headOffsetX={sHd?.offsetX ?? null}
                          headBox={sHd?.box ?? null}
                          accessories={sAccs}
                          activityLayers={[]}
                        />
                      );
                    })()}
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-semibold text-surface-text text-sm truncate">{outfit.name}</div>
                      <div className="text-[10px] text-surface-muted mt-0.5">{outfit.createdAt ? new Date(outfit.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''}</div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => handleApplySavedOutfit(outfit)}
                        className="text-[11px] font-display font-semibold text-white bg-accent-primary rounded-xl px-3 py-1.5 hover:opacity-90 transition-all"
                      >
                        Aplicar
                      </button>
                      <button
                        onClick={() => handleRemoveSavedOutfit(outfit)}
                        className="text-[11px] font-display font-semibold text-surface-muted bg-surface-hover border border-surface-border rounded-xl px-3 py-1.5 hover:text-surface-text hover:border-red-400/40 transition-all"
                      >
                        🗑 Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Botón guardar outfit actual desde el modal */}
            <button
              onClick={handleSaveCurrentOutfit}
              disabled={activeOutfit === 'out_none'}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-surface-border bg-surface-bg text-surface-text font-display font-semibold text-sm hover:bg-surface-card transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-bg"
            >
              <span style={{ fontVariantEmoji: 'emoji' }}>💾</span>
              Guardar outfit actual
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
