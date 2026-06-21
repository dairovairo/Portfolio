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
          accessorySrc={null}
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
function AccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={accessory.price}
      isBase={accessory.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + accesorio en capa 3 */}
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
          accessorySrc={accessory.src}
          accessoryIsChain={accessory.isChain ?? false}
          accessoryIsGrillz={accessory.isGrillz ?? false}
          accessoryIsTie={accessory.isTie ?? false}
          accessoryIsBowTie={accessory.isBowTie ?? false}
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
    </ItemCard>
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
          accessorySrc={null}
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
          outfitSrc={null}
          headSrc={null}
          accessorySrc={null}
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
          outfitSrc={null}
          feetSrc={null}
          accessorySrc={null}
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

// ── ShopPage ──────────────────────────────────────────────────────────────────
export default function ShopPage() {
  const navigate = useNavigate();
  const {
    unlockedActivities, unlockedAccessories, unlockedOutfits, unlockedFeet, unlockedHead,
    activeActivity, activeAccessory, activeOutfit, activeFeet, activeHead,
    unlockActivity, unlockAccessory, unlockOutfit, unlockFeet, unlockHead,
    equipActivity, equipAccessory, equipOutfit, equipFeet, equipHead,
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

  // ── Accesorios ──────────────────────────────────────────────────────────────
  function handleBuyAccessory(accessory) {
    if (coins < accessory.price) return;
    setCoins(c => c - accessory.price);
    unlockAccessory(accessory.id);
    equipAccessory(accessory.id);
    showToast(`¡${accessory.name} desbloqueado y equipado! 🎉`);
  }
  function handleEquipAccessory(accessory) {
    equipAccessory(accessory.id);
    showToast(`¡${accessory.name} equipado! ✨`);
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
  const activeAcc  = MASCOT_ACCESSORIES.find(a => a.id === activeAccessory);
  const activeOut  = MASCOT_OUTFITS.find(o => o.id === activeOutfit);
  const activeFt   = MASCOT_FEET.find(f => f.id === activeFeet);
  const activeHd   = MASCOT_HEAD.find(h => h.id === activeHead);

  // Outfits (torso) filtrados por sub-tab
  const filteredOutfits = MASCOT_OUTFITS.filter(o =>
    o.isBase || o.subcategory === outfitSubTab
  );

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-primary text-white px-5 py-3
          rounded-2xl text-sm font-display font-semibold shadow-lg shadow-accent-primary/30 animate-slide-down whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Header */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
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

      {/* Preview mascota activa con las 6 capas */}
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-4">
          <MascotDisplay tier="mid" size={72} />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="font-display font-bold text-surface-text text-sm">Tu mascota ahora</div>
            <div className="text-[11px] text-surface-muted">
              Pies: <span className="text-accent-glow font-semibold">{activeFt?.name ?? 'Ninguno'}</span>
            </div>
            <div className="text-[11px] text-surface-muted">
              Torso: <span className="text-accent-glow font-semibold">{activeOut?.name ?? 'Ninguno'}</span>
            </div>
            <div className="text-[11px] text-surface-muted">
              Cabeza: <span className="text-accent-glow font-semibold">{activeHd?.name ?? 'Ninguna'}</span>
            </div>
            <div className="text-[11px] text-surface-muted">
              Accesorio: <span className="text-accent-glow font-semibold">{activeAcc?.name ?? 'Ninguno'}</span>
            </div>
            <div className="text-[11px] text-surface-muted">
              Actividad: <span className="text-accent-glow font-semibold">{activeAct?.name ?? 'Ninguna'}</span>
            </div>
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
            {MASCOT_ACTIVITIES.map(activity => (
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
              <div className="grid grid-cols-2 gap-3">
                {MASCOT_FEET.map(feet => (
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

                <div className="grid grid-cols-2 gap-3">
                  {filteredOutfits.map(outfit => (
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
              <div className="grid grid-cols-2 gap-3">
                {MASCOT_HEAD.map(head => (
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
            )}
          </div>
        )}

        {/* ── Accesorios ── */}
        {tab === 'accessories' && (
          <div className="grid grid-cols-2 gap-3">
            {MASCOT_ACCESSORIES.map(accessory => (
              <AccessoryCard
                key={accessory.id}
                accessory={accessory}
                isUnlocked={unlockedAccessories.has(accessory.id)}
                isActive={activeAccessory === accessory.id}
                canAfford={coins >= accessory.price}
                onBuy={() => handleBuyAccessory(accessory)}
                onEquip={() => handleEquipAccessory(accessory)}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
