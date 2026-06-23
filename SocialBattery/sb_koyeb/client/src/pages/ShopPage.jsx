import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import FeetColorEditorModal from '../components/FeetColorEditorModal';
import { MASCOT_ACTIVITIES, MASCOT_ACCESSORIES, MASCOT_OUTFITS, MASCOT_FEET, MASCOT_HEAD, useMascot } from '../context/MascotContext';

const COINS = 340;

// ── Botón de reset "Sin X" — aparece siempre encima de los carruseles/grid ───
// Botón ancho, compacto, sin preview de mascota. Se usa en todas las secciones
// que tienen un ítem base para devolver la categoría a su estado original.
function ResetButton({ label, emoji = '✨', isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-display font-semibold transition-all duration-200 mb-3
        ${isActive
          ? 'bg-accent-primary/10 border-accent-primary/40 text-accent-glow'
          : 'bg-surface-card border-surface-border text-surface-muted hover:border-accent-primary/30 hover:text-surface-text'
        }`}
    >
      <span style={{ fontVariantEmoji: 'emoji' }}>{emoji}</span>
      <span className="flex-1 text-left">{label}</span>
      {isActive && (
        <span className="text-[10px] font-mono bg-accent-primary text-white px-2 py-0.5 rounded-lg">✓ Activo</span>
      )}
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
            <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
              ✓ Equipado
            </div>
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
function ActivityCard({ activity, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
          tier="mid"
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
function AccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onToggle }) {
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
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier="mid"
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
function CompactAccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onToggle }) {
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
          tier="mid"
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
function OutfitCard({ outfit, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier="mid"
          size={112}
          outfitSrc={outfit.src}
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
function BasicOutfitCard({ outfit, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
          tier="mid"
          size={112}
          outfitSrc={outfit.src}
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
            <div className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5">
              Puesto
            </div>
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
function BasicFeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip, onCustomize, isCustomized }) {
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
        {/* Botón de personalización extrema de color — siempre visible para
            poder repintar esta zapatilla a cualquier color, esté o no
            comprada/equipada. */}
        <button
          onClick={(e) => { e.stopPropagation(); onCustomize(); }}
          title="Personalizar colores"
          className="absolute top-1 left-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-surface-card/90 border border-surface-border text-xs hover:border-accent-primary/50 hover:bg-surface-hover transition-all"
        >
          <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
          {isCustomized && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-glow" />
          )}
        </button>
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier="mid"
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
            <div className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5">
              Puesto
            </div>
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
function FeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip, onCustomize, isCustomized }) {
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
            "suelto" de calzado (mocasines, zapatos…), igual que en los
            carruseles de zapatillas. */}
        <button
          onClick={(e) => { e.stopPropagation(); onCustomize(); }}
          title="Personalizar colores"
          className="absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-surface-card/90 border border-surface-border text-sm hover:border-accent-primary/50 hover:bg-surface-hover transition-all"
        >
          <span style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
          {isCustomized && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-glow" />
          )}
        </button>
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier="mid"
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
function HeadCard({ head, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        <MascotDisplay
          tier="mid"
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
function BasicHeadCard({ head, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
          tier="mid"
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
            <div className="w-full text-center text-[10px] font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-lg py-1.5">
              Puesto
            </div>
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
  const {
    unlockedActivities, unlockedAccessories, unlockedOutfits, unlockedFeet, unlockedHead,
    activeActivity, activeAccessories, activeOutfit, activeFeet, activeHead,
    unlockActivity, unlockAccessory, unlockOutfit, unlockFeet, unlockHead,
    equipActivity, toggleAccessory, equipOutfit, equipFeet, equipHead,
    getFeetZones, saveFeetZones, hasFeetCustomization,
  } = useMascot();

  const [tab, setTab]                   = useState('activities');
  const [outfitMainTab, setOutfitMainTab] = useState('torso'); // 'pies' | 'torso' | 'cabeza'
  const [outfitSubTab, setOutfitSubTab] = useState('camiseta'); // 'camiseta' | 'camisa'
  const [coins, setCoins]       = useState(COINS);
  const [toast, setToast]       = useState(null);
  // Ítem de calzado que se está personalizando en el editor de color (null
  // = modal cerrado). Se guarda el objeto completo del catálogo (no solo
  // el id) para poder mostrar su nombre/imagen en el modal directamente.
  const [editingFeetItem, setEditingFeetItem] = useState(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Botón "🎨 Personalizar" de cada carrusel horizontal: aplica sobre la
  // zapatilla actualmente equipada de esa familia (si hay una puesta) o,
  // si no, sobre la primera variante de color de la familia.
  function pickCarouselTarget(family) {
    return family.find(f => f.id === activeFeet) ?? family[0] ?? null;
  }

  function handleSaveFeetColors(zones) {
    saveFeetZones(editingFeetItem.id, zones);
    showToast(`¡Colores de "${editingFeetItem.name}" guardados! 🎨`);
    setEditingFeetItem(null);
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
    equipActivity(activity.id);
    showToast(`¡${activity.name} equipada! ✨`);
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
    equipOutfit(outfit.id);
    showToast(`¡${outfit.name} puesta! ✨`);
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
    equipFeet(feet.id);
    showToast(`¡${feet.name} puesto! ✨`);
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
    equipHead(head.id);
    showToast(`¡${head.name} puesta! ✨`);
  }

  const activeAct  = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
  // El ítem base ("Sin actividad") SÍ se muestra en la tienda, como una
  // tarjeta más al principio del grid (ya es el primer elemento del array
  // MASCOT_ACTIVITIES), a diferencia del resto de ítems base de
  // outfit/accesorios, que siguen excluidos.
  const activityOptions = MASCOT_ACTIVITIES;
  const activeAccs = MASCOT_ACCESSORIES.filter(a => activeAccessories.has(a.id));
  const activeOut  = MASCOT_OUTFITS.find(o => o.id === activeOutfit);
  const activeFt   = MASCOT_FEET.find(f => f.id === activeFeet);
  const activeHd   = MASCOT_HEAD.find(h => h.id === activeHead);

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

  // Accesorios: los ítems "Sin X" de cada grupo de selección única (gafas,
  // cadenas, grillz, corbatas, pajaritas) salen de sus carruseles y se
  // muestran como ResetButton encima de cada uno. El ítem general "Sin
  // accesorio" (acc_none) va como ResetButton encima de todo el tab.
  const baseAccessory      = MASCOT_ACCESSORIES.find(a => a.isBase && !a.isChain && !a.isGrillz && !a.isGlasses && !a.isTie && !a.isBowTie) ?? null;
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
      return !MASCOT_ACCESSORIES.some(other =>
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

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-primary text-white px-5 py-3
          rounded-2xl text-sm font-display font-semibold shadow-lg shadow-accent-primary/30 animate-slide-down whitespace-nowrap">
          {toast}
        </div>
      )}

      {editingFeetItem && (
        <FeetColorEditorModal
          item={editingFeetItem}
          initialZones={getFeetZones(editingFeetItem.id)}
          onClose={() => setEditingFeetItem(null)}
          onSave={handleSaveFeetColors}
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
            tier="mid"
            size={72}
            outfitSrc={activeOut?.src ?? null}
            outfitSubcategory={activeOut?.subcategory ?? null}
            outfitItemOffsetY={activeOut?.offsetY ?? null}
            outfitItemScale={activeOut?.scale ?? null}
            feetSrc={activeFt?.src ?? null}
            feetItemId={activeFt?.id ?? null}
            feetOffsetY={activeFt?.offsetY ?? null}
            feetOffsetX={activeFt?.offsetX ?? null}
            feetScale={activeFt?.scale ?? null}
            headSrc={activeHd?.src ?? null}
            headScale={activeHd?.scale ?? null}
            headOffsetY={activeHd?.offsetY ?? null}
            headOffsetX={activeHd?.offsetX ?? null}
            headBox={activeHd?.box ?? null}
            accessories={activeAccs}
            activityLayers={activeAct?.layers ?? []}
          />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="font-display font-bold text-surface-text text-sm">Tu mascota ahora</div>
            <div className="text-[10px] text-surface-muted/60 mt-0.5">
              Ganas 🪙 actualizando tu batería cada día.
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
                {/* Botón reset — encima de todos los carruseles y el grid */}
                {baseFeet && (
                  <ResetButton
                    label={baseFeet.name}
                    emoji={baseFeet.emoji}
                    isActive={activeFeet === baseFeet.id}
                    onClick={() => handleEquipFeet(baseFeet)}
                  />
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
                        onClick={() => setEditingFeetItem(pickCarouselTarget(basicFeet))}
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
                          onCustomize={() => setEditingFeetItem(feet)}
                          isCustomized={hasFeetCustomization(feet.id)}
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
                        onClick={() => setEditingFeetItem(pickCarouselTarget(basicFeet2))}
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
                          onCustomize={() => setEditingFeetItem(feet)}
                          isCustomized={hasFeetCustomization(feet.id)}
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
                      onCustomize={() => setEditingFeetItem(feet)}
                      isCustomized={hasFeetCustomization(feet.id)}
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

                {/* Botón reset — encima del carrusel y el grid */}
                {baseOutfit && (
                  <ResetButton
                    label={baseOutfit.name}
                    emoji={baseOutfit.emoji ?? '✨'}
                    isActive={activeOutfit === baseOutfit.id}
                    onClick={() => handleEquipOutfit(baseOutfit)}
                  />
                )}

                {/* Carrusel horizontal: básicos de colores lisos de esta
                    sub-tab (camisetas o camisas), siempre visible arriba del
                    scroll vertical principal. */}
                {basicOutfits.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                      Básicos
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
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sección: Cabeza */}
            {outfitMainTab === 'cabeza' && (
              <div className="flex flex-col gap-4">
                {/* Botón reset — encima de todos los carruseles y el grid */}
                {baseHead && (
                  <ResetButton
                    label={baseHead.name}
                    emoji={baseHead.emoji ?? '✨'}
                    isActive={activeHead === baseHead.id}
                    onClick={() => handleEquipHead(baseHead)}
                  />
                )}

                {/* Carrusel: basicHead (mismo molde, distinto color de visera).
                    Etiqueta mostrada: "Gorras lisas" (intercambiada con la del
                    carrusel basicHead2 de abajo). */}
                {basicHead.length > 0 && (
                  <div>
                    <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                      Gorras lisas
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
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Carrusel: basicHead2 (molde liso de un solo color + las 6
                    gorras nuevas bicolor con costura central, añadidas aquí).
                    Etiqueta mostrada: "Gorras" (intercambiada con la del
                    carrusel basicHead de arriba). */}
                {basicHead2.length > 0 && (
                  <div>
                    <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                      Gorras
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
                        />
                      ))}
                    </div>
                  </div>
                )}

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
            {/* Botón reset general — quita todos los accesorios a la vez */}
            {baseAccessory && (
              <ResetButton
                label={baseAccessory.name}
                emoji={baseAccessory.emoji}
                isActive={isAccessoryCardActive(baseAccessory)}
                onClick={() => handleToggleAccessory(baseAccessory)}
              />
            )}

            {/* Carrusel: Cadenas — elige una */}
            {chainAccessories.length > 0 && (
              <div>
                {baseChain && (
                  <ResetButton
                    label={baseChain.name}
                    emoji={baseChain.emoji}
                    isActive={isAccessoryCardActive(baseChain)}
                    onClick={() => handleToggleAccessory(baseChain)}
                  />
                )}
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Cadenas · elige una
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {chainAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Grillz — elige uno */}
            {grillzAccessories.length > 0 && (
              <div>
                {baseGrillz && (
                  <ResetButton
                    label={baseGrillz.name}
                    emoji={baseGrillz.emoji}
                    isActive={isAccessoryCardActive(baseGrillz)}
                    onClick={() => handleToggleAccessory(baseGrillz)}
                  />
                )}
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Grillz · elige uno
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {grillzAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Gafas de sol — elige unas */}
            {glassesAccessories.length > 0 && (
              <div>
                {baseGlasses && (
                  <ResetButton
                    label={baseGlasses.name}
                    emoji={baseGlasses.emoji}
                    isActive={isAccessoryCardActive(baseGlasses)}
                    onClick={() => handleToggleAccessory(baseGlasses)}
                  />
                )}
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Gafas de sol · elige unas
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {glassesAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Corbatas — elige una */}
            {tieAccessories.length > 0 && (
              <div>
                {baseTie && (
                  <ResetButton
                    label={baseTie.name}
                    emoji={baseTie.emoji}
                    isActive={isAccessoryCardActive(baseTie)}
                    onClick={() => handleToggleAccessory(baseTie)}
                  />
                )}
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Corbatas · elige una
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {tieAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Carrusel: Pajaritas — elige una */}
            {bowTieAccessories.length > 0 && (
              <div>
                {baseBowTie && (
                  <ResetButton
                    label={baseBowTie.name}
                    emoji={baseBowTie.emoji}
                    isActive={isAccessoryCardActive(baseBowTie)}
                    onClick={() => handleToggleAccessory(baseBowTie)}
                  />
                )}
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Pajaritas · elige una
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {bowTieAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={isAccessoryCardActive(accessory)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
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
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
