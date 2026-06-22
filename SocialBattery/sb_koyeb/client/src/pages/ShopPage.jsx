import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import { MASCOT_ACTIVITIES, MASCOT_ACCESSORIES, MASCOT_OUTFITS, MASCOT_FEET, MASCOT_HEAD, useMascot } from '../context/MascotContext';

const COINS = 340;

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
        {isUnlocked ? (
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
function BasicFeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
          feetSrc={feet.src}
          feetOffsetY={feet.offsetY ?? null}
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
function FeetCard({ feet, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
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
          feetOffsetY={feet.offsetY ?? null}
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
  } = useMascot();

  const [tab, setTab]                   = useState('activities');
  const [outfitMainTab, setOutfitMainTab] = useState('torso'); // 'pies' | 'torso' | 'cabeza'
  const [outfitSubTab, setOutfitSubTab] = useState('camiseta'); // 'camiseta' | 'camisa'
  const [coins, setCoins]       = useState(COINS);
  const [toast, setToast]       = useState(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
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
  // El ítem base ("Sin actividad") se excluye de la tienda, igual que el
  // resto de ítems base en outfit/accesorios.
  const activityOptions = MASCOT_ACTIVITIES.filter(a => !a.isBase);
  const activeAccs = MASCOT_ACCESSORIES.filter(a => activeAccessories.has(a.id));
  const activeOut  = MASCOT_OUTFITS.find(o => o.id === activeOutfit);
  const activeFt   = MASCOT_FEET.find(f => f.id === activeFeet);
  const activeHd   = MASCOT_HEAD.find(h => h.id === activeHead);

  // Outfits (torso) filtrados por sub-tab
  // - basicOutfits: colores lisos de esa sub-tab → carrusel horizontal arriba
  // - restOutfits: el resto de prendas (estampados/temáticas) de esa
  //   sub-tab → grid vertical de siempre
  // El ítem base ("Sin outfit") se excluye de la tienda: es redundante en
  // el sistema actual y no se muestra como tarjeta.
  const filteredOutfits = MASCOT_OUTFITS.filter(o => !o.isBase && o.subcategory === outfitSubTab);
  const basicOutfits = filteredOutfits.filter(o => o.isBasic);
  const restOutfits  = filteredOutfits.filter(o => !o.isBasic);

  // Pies: misma lógica que Torso — las variantes de color de la zapatilla
  // retro (isBasic) van al carrusel horizontal; el resto (chunky, mocasines,
  // oxford) va al grid vertical de siempre. El ítem base ("Sin calzado")
  // se excluye de la tienda, igual que el resto de ítems base.
  const basicFeet = MASCOT_FEET.filter(f => f.isBasic);
  const restFeet   = MASCOT_FEET.filter(f => !f.isBasic && !f.isBase);

  // Cabeza: misma lógica que Pies/Torso — las gorras "negra y X" (mismo
  // molde, distinto color de visera) van al carrusel horizontal; el resto
  // (sombreros, gorro de fiesta, boina, halo...) va al grid vertical de
  // siempre. El ítem base ("Sin gorro") se excluye de la tienda.
  // Hay un SEGUNDO molde de gorra ("Gorra negra" liso, sin visera bicolor)
  // con sus propias variantes de color → su propio carrusel horizontal
  // (isBasic2), independiente del de las gorras "negra y X" (isBasic).
  const basicHead  = MASCOT_HEAD.filter(h => h.isBasic);
  const basicHead2 = MASCOT_HEAD.filter(h => h.isBasic2);
  const restHead    = MASCOT_HEAD.filter(h => !h.isBase && !h.isBasic && !h.isBasic2);

  // Accesorios: cadenas, grillz y gafas de sol son grupos de selección
  // única (solo una de cada a la vez) → cada grupo va a su propio carrusel
  // horizontal arriba. El resto (corbata, pajarita) se puede combinar
  // libremente y va al grid vertical de siempre. El ítem base
  // ("Sin accesorio") se excluye de la tienda, igual que el resto de
  // ítems base.
  const chainAccessories   = MASCOT_ACCESSORIES.filter(a => a.isChain);
  const grillzAccessories  = MASCOT_ACCESSORIES.filter(a => a.isGrillz);
  const glassesAccessories = MASCOT_ACCESSORIES.filter(a => a.isGlasses);
  const restAccessories    = MASCOT_ACCESSORIES.filter(
    a => !a.isChain && !a.isGrillz && !a.isGlasses && !a.isBase
  );

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-primary text-white px-5 py-3
          rounded-2xl text-sm font-display font-semibold shadow-lg shadow-accent-primary/30 animate-slide-down whitespace-nowrap">
          {toast}
        </div>
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
            feetOffsetY={activeFt?.offsetY ?? null}
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
                      ? 'bg-accent-primary/20 text-accent-glow border border-accent-primary/30'
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
                {/* Carrusel horizontal: colores de la zapatilla retro (misma
                    silueta, distinto color), siempre visible arriba del
                    scroll vertical principal. */}
                {basicFeet.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                      Colores
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
                          ? 'bg-accent-primary/20 text-accent-glow border border-accent-primary/30'
                          : 'text-surface-muted hover:text-surface-text'
                        }`}
                    >
                      <span style={{ fontVariantEmoji: 'emoji' }}>{s.emoji}</span>
                      {s.label}
                    </button>
                  ))}
                </div>

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
            {/* Carrusel: Cadenas — elige una */}
            {chainAccessories.length > 0 && (
              <div>
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Cadenas · elige una
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {chainAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessories.has(accessory.id)}
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
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Grillz · elige uno
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {grillzAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessories.has(accessory.id)}
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
                <div className="text-[11px] font-display font-semibold text-surface-muted px-0.5 mb-1.5">
                  Gafas de sol · elige unas
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
                  {glassesAccessories.map(accessory => (
                    <CompactAccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessories.has(accessory.id)}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onToggle={() => handleToggleAccessory(accessory)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Resto de accesorios — selección libre, combinables entre sí
                y con lo elegido en los 3 carruseles de arriba */}
            <div className="grid grid-cols-2 gap-3">
              {restAccessories.map(accessory => (
                <AccessoryCard
                  key={accessory.id}
                  accessory={accessory}
                  isUnlocked={unlockedAccessories.has(accessory.id)}
                  isActive={activeAccessories.has(accessory.id)}
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
