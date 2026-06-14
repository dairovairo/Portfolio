import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import {
  MASCOT_ACTIVITIES,
  MASCOT_ACCESSORIES,
  MASCOT_OUTFIT_HEAD,
  MASCOT_OUTFIT_ACCESSORIES,
  MASCOT_OUTFIT_SHIRTS,
  useMascot,
} from '../context/MascotContext';

const COINS = 340;

// ── Tarjeta genérica ──────────────────────────────────────────────────────────
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
    <ItemCard isUnlocked={isUnlocked} isActive={isActive} canAfford={canAfford} price={activity.price} isBase={activity.isBase} onBuy={onBuy} onEquip={onEquip}>
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
        <MascotDisplay tier="mid" size={112} activityLayers={activity.layers} accessorySrc={null}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}} />
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
    <ItemCard isUnlocked={isUnlocked} isActive={isActive} canAfford={canAfford} price={accessory.price} isBase={accessory.isBase} onBuy={onBuy} onEquip={onEquip}>
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
        <MascotDisplay tier="mid" size={112} accessorySrc={accessory.src}
          accessoryIsChain={accessory.isChain ?? false} activityLayers={[]}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}} />
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

// ── Tarjeta de OUTFIT genérica (cabeza / accesorios outfit / camisas) ─────────
function OutfitCard({ item, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
  return (
    <ItemCard isUnlocked={isUnlocked} isActive={isActive} canAfford={canAfford} price={item.price} isBase={item.isBase} onBuy={onBuy} onEquip={onEquip}>
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30 min-h-[120px]">
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Equipado
          </span>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
            <span className="text-3xl">🔒</span>
          </div>
        )}
        {item.src ? (
          <img
            src={item.src}
            alt={item.name}
            className="w-24 h-24 object-contain"
            style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
          />
        ) : (
          <span className="text-4xl" style={{ fontVariantEmoji: 'emoji' }}>{item.emoji}</span>
        )}
      </div>
      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{item.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{item.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{item.desc}</div>
      </div>
    </ItemCard>
  );
}

// ── ShopPage ──────────────────────────────────────────────────────────────────
export default function ShopPage() {
  const navigate = useNavigate();
  const {
    unlockedActivities, unlockedAccessories,
    unlockedHead, unlockedOutfitAccs, unlockedShirts,
    activeActivity, activeAccessory,
    activeHead, activeOutfitAcc, activeShirt,
    unlockActivity, unlockAccessory,
    unlockHead, unlockOutfitAcc, unlockShirt,
    equipActivity, equipAccessory,
    equipHead, equipOutfitAcc, equipShirt,
  } = useMascot();

  const [tab, setTab]         = useState('activities');
  const [outfitSub, setOutfitSub] = useState('head');
  const [coins, setCoins]     = useState(COINS);
  const [toast, setToast]     = useState(null);

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
  function handleBuyAccessory(accessory) {
    if (coins < accessory.price) return;
    setCoins(c => c - accessory.price);
    unlockAccessory(accessory.id);
    equipAccessory(accessory.id);
    showToast(`¡${accessory.name} desbloqueado y equipado! 🎉`);
  }
  function handleBuyOutfit(item, unlockFn, equipFn) {
    if (coins < item.price) return;
    setCoins(c => c - item.price);
    unlockFn(item.id);
    equipFn(item.id);
    showToast(`¡${item.name} desbloqueado y equipado! 🎉`);
  }

  const activeAcc = MASCOT_ACCESSORIES.find(a => a.id === activeAccessory);
  const activeAct = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);

  const OUTFIT_SUBS = [
    { key: 'head',       label: 'Cabeza',     emoji: '🕶️' },
    { key: 'outfitacc', label: 'Accesorios', emoji: '💫' },
    { key: 'shirts',    label: 'Camisas',    emoji: '👕' },
  ];

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
            { key: 'accessories', label: 'Accesorios',  emoji: '👟' },
            { key: 'outfit',      label: 'Outfit',       emoji: '👕' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl text-xs font-display font-semibold transition-all duration-200
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
                onEquip={() => { equipActivity(activity.id); showToast(`¡${activity.name} equipada! ✨`); }}
              />
            ))}
          </div>
        )}

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
                onEquip={() => { equipAccessory(accessory.id); showToast(`¡${accessory.name} equipado! ✨`); }}
              />
            ))}
          </div>
        )}

        {tab === 'outfit' && (
          <>
            {/* Subtabs de outfit */}
            <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-1 mb-4">
              {OUTFIT_SUBS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setOutfitSub(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
                    ${outfitSub === s.key
                      ? 'bg-surface-hover text-surface-text border border-surface-border'
                      : 'text-surface-muted hover:text-surface-text'
                    }`}
                >
                  <span style={{ fontVariantEmoji: 'emoji' }}>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Cabeza */}
            {outfitSub === 'head' && (
              <div className="grid grid-cols-2 gap-3">
                {MASCOT_OUTFIT_HEAD.map(item => (
                  <OutfitCard
                    key={item.id}
                    item={item}
                    isUnlocked={unlockedHead.has(item.id)}
                    isActive={activeHead === item.id}
                    canAfford={coins >= item.price}
                    onBuy={() => handleBuyOutfit(item, unlockHead, equipHead)}
                    onEquip={() => { equipHead(item.id); showToast(`¡${item.name} equipado! ✨`); }}
                  />
                ))}
              </div>
            )}

            {/* Accesorios outfit */}
            {outfitSub === 'outfitacc' && (
              <div className="grid grid-cols-2 gap-3">
                {MASCOT_OUTFIT_ACCESSORIES.map(item => (
                  <OutfitCard
                    key={item.id}
                    item={item}
                    isUnlocked={unlockedOutfitAccs.has(item.id)}
                    isActive={activeOutfitAcc === item.id}
                    canAfford={coins >= item.price}
                    onBuy={() => handleBuyOutfit(item, unlockOutfitAcc, equipOutfitAcc)}
                    onEquip={() => { equipOutfitAcc(item.id); showToast(`¡${item.name} equipado! ✨`); }}
                  />
                ))}
              </div>
            )}

            {/* Camisas */}
            {outfitSub === 'shirts' && (
              <div className="grid grid-cols-2 gap-3">
                {MASCOT_OUTFIT_SHIRTS.map(item => (
                  <OutfitCard
                    key={item.id}
                    item={item}
                    isUnlocked={unlockedShirts.has(item.id)}
                    isActive={activeShirt === item.id}
                    canAfford={coins >= item.price}
                    onBuy={() => handleBuyOutfit(item, unlockShirt, equipShirt)}
                    onEquip={() => { equipShirt(item.id); showToast(`¡${item.name} equipada! ✨`); }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
