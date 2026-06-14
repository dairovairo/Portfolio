import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import { MASCOT_ACTIVITIES, MASCOT_ACCESSORIES, useMascot } from '../context/MascotContext';

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
      {/* Preview con capas: mascota base + actividad encima */}
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

// ── Tarjeta de ACCESORIO/OUTFIT ───────────────────────────────────────────────
function AccessoryCard({ accessory, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
  return (
    <ItemCard
      isUnlocked={isUnlocked} isActive={isActive}
      canAfford={canAfford} price={accessory.price}
      isBase={accessory.isBase} onBuy={onBuy} onEquip={onEquip}
    >
      {/* Preview: mascota base + accesorio en capa intermedia */}
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

// ── Placeholder vacío para sub-secciones sin items aún ───────────────────────
function EmptySlot({ label }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center py-10 text-center gap-2">
      <span className="text-3xl opacity-30">🧥</span>
      <p className="text-surface-muted text-sm font-display">
        No hay {label} disponibles todavía
      </p>
    </div>
  );
}

// ── Sub-tabs de Torso ─────────────────────────────────────────────────────────
const TORSO_SUBTABS = [
  { key: 'camisetas', label: 'Camisetas', emoji: '👕' },
  { key: 'camisas',   label: 'Camisas',   emoji: '👔' },
];

// ── Secciones dentro de Outfit ────────────────────────────────────────────────
const OUTFIT_SECTIONS = [
  { key: 'pies',       label: 'Pies',       emoji: '👟' },
  { key: 'torso',      label: 'Torso',      emoji: '👕' },
  { key: 'cabeza',     label: 'Cabeza',     emoji: '🧢' },
  { key: 'accesorios', label: 'Accesorios', emoji: '⛓️' },
];

// ── ShopPage ──────────────────────────────────────────────────────────────────
export default function ShopPage() {
  const navigate = useNavigate();
  const {
    unlockedActivities, unlockedAccessories,
    activeActivity, activeAccessory,
    unlockActivity, unlockAccessory,
    equipActivity, equipAccessory,
  } = useMascot();

  const [tab, setTab]               = useState('activities');
  const [outfitSection, setOutfitSection] = useState('pies');
  const [torsoSubtab, setTorsoSubtab]     = useState('camisetas');
  const [coins, setCoins]           = useState(COINS);
  const [toast, setToast]           = useState(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

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

  const activeAct = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
  const activeAcc = MASCOT_ACCESSORIES.find(a => a.id === activeAccessory);

  // Items filtrados por sección de outfit
  const itemsBySection = (section) =>
    MASCOT_ACCESSORIES.filter(a => a.outfitCategory === section && !a.isBase);

  // Para torso, sub-filtramos por subcategoría (cuando haya items con outfitSubcategory)
  const torsoItems = (sub) =>
    MASCOT_ACCESSORIES.filter(a =>
      a.outfitCategory === 'torso' &&
      (a.outfitSubcategory === sub) &&
      !a.isBase
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

      {/* Preview mascota activa */}
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-4">
          <MascotDisplay tier="mid" size={72} />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="font-display font-bold text-surface-text text-sm">Tu mascota ahora</div>
            <div className="text-[11px] text-surface-muted">
              Outfit: <span className="text-accent-glow font-semibold">{activeAcc?.name ?? 'Ninguno'}</span>
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

      {/* Tab bar principal: Actividades | Outfit */}
      <div className="max-w-lg mx-auto w-full px-4 py-3">
        <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-1">
          {[
            { key: 'activities', label: 'Actividades', emoji: '⚡' },
            { key: 'outfit',     label: 'Outfit',       emoji: '👗' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-display font-semibold transition-all duration-200
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

      {/* ── Contenido ── */}
      <div className="max-w-lg mx-auto w-full px-4 pb-32 flex-1 flex flex-col gap-3">

        {/* ── ACTIVIDADES ── */}
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

        {/* ── OUTFIT ── */}
        {tab === 'outfit' && (
          <>
            {/* Sub-navegación: Pies | Torso | Cabeza | Accesorios */}
            <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-0.5">
              {OUTFIT_SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setOutfitSection(s.key)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 rounded-xl text-[11px] font-display font-semibold transition-all duration-200
                    ${outfitSection === s.key
                      ? 'bg-accent-primary text-white shadow-sm'
                      : 'text-surface-muted hover:text-surface-text'
                    }`}
                >
                  <span style={{ fontVariantEmoji: 'emoji' }} className="text-base leading-tight">{s.emoji}</span>
                  <span className="leading-tight mt-0.5">{s.label}</span>
                </button>
              ))}
            </div>

            {/* ── PIES ── */}
            {outfitSection === 'pies' && (
              <div className="grid grid-cols-2 gap-3">
                {itemsBySection('pies').length > 0 ? (
                  itemsBySection('pies').map(accessory => (
                    <AccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessory === accessory.id}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onEquip={() => handleEquipAccessory(accessory)}
                    />
                  ))
                ) : (
                  <EmptySlot label="zapatillas" />
                )}
              </div>
            )}

            {/* ── TORSO ── */}
            {outfitSection === 'torso' && (
              <>
                {/* Sub-tabs: Camisetas | Camisas */}
                <div className="flex bg-surface-hover border border-surface-border rounded-xl p-1 gap-1">
                  {TORSO_SUBTABS.map(st => (
                    <button
                      key={st.key}
                      onClick={() => setTorsoSubtab(st.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-display font-semibold transition-all duration-200
                        ${torsoSubtab === st.key
                          ? 'bg-surface-card text-surface-text shadow-sm border border-surface-border'
                          : 'text-surface-muted hover:text-surface-text'
                        }`}
                    >
                      <span style={{ fontVariantEmoji: 'emoji' }}>{st.emoji}</span>
                      {st.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {torsoItems(torsoSubtab).length > 0 ? (
                    torsoItems(torsoSubtab).map(accessory => (
                      <AccessoryCard
                        key={accessory.id}
                        accessory={accessory}
                        isUnlocked={unlockedAccessories.has(accessory.id)}
                        isActive={activeAccessory === accessory.id}
                        canAfford={coins >= accessory.price}
                        onBuy={() => handleBuyAccessory(accessory)}
                        onEquip={() => handleEquipAccessory(accessory)}
                      />
                    ))
                  ) : (
                    <EmptySlot label={torsoSubtab} />
                  )}
                </div>
              </>
            )}

            {/* ── CABEZA ── */}
            {outfitSection === 'cabeza' && (
              <div className="grid grid-cols-2 gap-3">
                {itemsBySection('cabeza').length > 0 ? (
                  itemsBySection('cabeza').map(accessory => (
                    <AccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessory === accessory.id}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onEquip={() => handleEquipAccessory(accessory)}
                    />
                  ))
                ) : (
                  <EmptySlot label="items de cabeza" />
                )}
              </div>
            )}

            {/* ── ACCESORIOS ── */}
            {outfitSection === 'accesorios' && (
              <div className="grid grid-cols-2 gap-3">
                {itemsBySection('accesorios').length > 0 ? (
                  itemsBySection('accesorios').map(accessory => (
                    <AccessoryCard
                      key={accessory.id}
                      accessory={accessory}
                      isUnlocked={unlockedAccessories.has(accessory.id)}
                      isActive={activeAccessory === accessory.id}
                      canAfford={coins >= accessory.price}
                      onBuy={() => handleBuyAccessory(accessory)}
                      onEquip={() => handleEquipAccessory(accessory)}
                    />
                  ))
                ) : (
                  <EmptySlot label="accesorios" />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
