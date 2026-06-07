import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import MascotDisplay from '../components/MascotDisplay';
import { MASCOT_ACTIVITIES, useMascot } from '../context/MascotContext';

// ── Moneda ficticia (placeholder) ─────────────────────────────────────────────
const COINS = 340;

// ── Accesorios (sección futura, estructura lista) ─────────────────────────────
const ACCESSORIES = [
  { id: 'acc_hat',     name: 'Gorra chula',        emoji: '🧢', price: 45,  desc: 'Un look urbano para salir con estilo.' },
  { id: 'acc_glasses', name: 'Gafas de sol',       emoji: '😎', price: 60,  desc: 'Protección solar y estilo en uno.' },
  { id: 'acc_scarf',   name: 'Bufanda de colores', emoji: '🧣', price: 35,  desc: 'Colorida y cálida para los días fríos.' },
  { id: 'acc_bag',     name: 'Mochila viajera',    emoji: '🎒', price: 90,  desc: 'Para llevar todo lo necesario.' },
  { id: 'acc_headph',  name: 'Auriculares',        emoji: '🎧', price: 110, desc: 'Música en cualquier momento.' },
  { id: 'acc_star',    name: 'Pin de estrella',    emoji: '⭐', price: 20,  desc: 'Un pequeño detalle que lo dice todo.' },
  { id: 'acc_heart',   name: 'Pin de corazón',     emoji: '❤️', price: 20,  desc: 'Lleva el amor a todas partes.' },
  { id: 'acc_crown',   name: 'Corona dorada',      emoji: '👑', price: 200, desc: 'Para quienes reinan en lo social.' },
  { id: 'acc_balloon', name: 'Globos de fiesta',   emoji: '🎈', price: 25,  desc: 'Siempre es momento de celebrar.' },
  { id: 'acc_camera',  name: 'Cámara instax',      emoji: '📸', price: 130, desc: 'Captura los mejores momentos.' },
];

// ── Tarjeta de actividad ───────────────────────────────────────────────────────
function ActivityCard({ activity, isUnlocked, isActive, canAfford, onBuy, onEquip }) {
  return (
    <div
      className={`bg-surface-card border rounded-2xl overflow-hidden flex flex-col transition-all duration-200
        ${isActive
          ? 'border-accent-primary shadow-md shadow-accent-primary/20'
          : isUnlocked
            ? 'border-surface-border hover:border-accent-primary/40'
            : 'border-surface-border hover:border-surface-muted/40'
        }`}
    >
      {/* Preview con sistema de capas */}
      <div className="relative flex items-center justify-center py-4 px-2 bg-surface-hover/30">

        {/* Badge "Equipada" */}
        {isActive && (
          <span className="absolute top-2 right-2 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-accent-primary text-white z-10">
            ✓ Activa
          </span>
        )}

        {/* Lock overlay */}
        {!isUnlocked && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-t-2xl z-10"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
          >
            <span className="text-3xl">🔒</span>
          </div>
        )}

        {/* Mascota con capas de actividad */}
        <MascotDisplay
          tier="mid"
          size={112}
          activityLayers={activity.layers}
          style={!isUnlocked ? { filter: 'grayscale(0.5) brightness(0.7)' } : {}}
        />
      </div>

      {/* Info */}
      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span style={{ fontVariantEmoji: 'emoji' }}>{activity.emoji}</span>
          <div className="font-display font-bold text-surface-text text-sm leading-tight">{activity.name}</div>
        </div>
        <div className="text-surface-muted text-[11px] leading-snug flex-1">{activity.desc}</div>
      </div>

      {/* Acción */}
      <div className="px-3 pb-3 pt-1">
        {activity.isBase ? (
          isActive ? (
            <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
              ✓ Equipada
            </div>
          ) : (
            <button
              onClick={() => onEquip(activity)}
              className="w-full py-2 rounded-xl text-xs font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Equipar
            </button>
          )
        ) : isUnlocked ? (
          isActive ? (
            <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
              ✓ Equipada
            </div>
          ) : (
            <button
              onClick={() => onEquip(activity)}
              className="w-full py-2 rounded-xl text-xs font-display font-semibold bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
            >
              Equipar
            </button>
          )
        ) : (
          <button
            onClick={() => onBuy(activity)}
            disabled={!canAfford}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white hover:shadow-md hover:shadow-accent-primary/20'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {activity.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tarjeta de accesorio ──────────────────────────────────────────────────────
function AccessoryCard({ item, isOwned, canAfford, onBuy }) {
  return (
    <div
      className={`bg-surface-card border rounded-2xl p-4 flex flex-col gap-2 transition-all duration-200
        ${isOwned ? 'border-accent-primary/40' : 'border-surface-border hover:border-accent-primary/30'}`}
    >
      <div className="text-4xl text-center" style={{ fontVariantEmoji: 'emoji' }}>{item.emoji}</div>
      <div className="text-center flex-1">
        <div className="font-display font-bold text-surface-text text-sm leading-tight">{item.name}</div>
        <div className="text-surface-muted text-[11px] mt-1 leading-snug">{item.desc}</div>
      </div>
      <div className="mt-auto">
        {isOwned ? (
          <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
            ✓ En tu colección
          </div>
        ) : (
          <button
            onClick={() => onBuy(item)}
            disabled={!canAfford}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
              ${canAfford
                ? 'bg-accent-primary hover:bg-accent-primary/80 text-white hover:shadow-md hover:shadow-accent-primary/20'
                : 'bg-surface-hover text-surface-muted cursor-not-allowed border border-surface-border'
              }`}
          >
            🪙 {item.price}
          </button>
        )}
      </div>
    </div>
  );
}

// ── ShopPage ──────────────────────────────────────────────────────────────────
export default function ShopPage() {
  const navigate = useNavigate();
  const { unlocked, activeActivity, unlockActivity, equipActivity } = useMascot();

  const [tab, setTab]           = useState('activities');
  const [coins, setCoins]       = useState(COINS);
  const [ownedAcc, setOwnedAcc] = useState(new Set());
  const [toast, setToast]       = useState(null);

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

  function handleBuyAccessory(item) {
    if (coins < item.price) return;
    setCoins(c => c - item.price);
    setOwnedAcc(prev => new Set([...prev, item.id]));
    showToast(`¡${item.name} añadida a tu colección! 🎉`);
  }

  // Actividad actualmente equipada
  const activeAct = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {/* Toast */}
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
          {/* Saldo */}
          <div className="flex items-center gap-1.5 bg-surface-card border border-surface-border rounded-xl px-3 py-1.5">
            <span className="text-sm">🪙</span>
            <span className="font-mono font-bold text-accent-glow text-sm">{coins}</span>
          </div>
        </div>
      </nav>

      {/* Preview mascota activa con capas */}
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-2">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-4">
          {/* Miniatura con la actividad equipada */}
          <MascotDisplay
            tier="mid"
            size={72}
            activityLayers={activeAct?.layers ?? []}
          />
          <div className="flex-1">
            <div className="font-display font-bold text-surface-text text-sm">Personaliza tu mascota</div>
            <div className="text-surface-muted text-xs mt-0.5 leading-snug">
              Actividad equipada: <span className="text-accent-glow font-semibold">{activeAct?.name ?? 'Ninguna'}</span>
            </div>
            <div className="text-surface-muted text-[10px] mt-1 leading-snug">
              Las actividades se superponen sobre la mascota. Ganas 🪙 actualizando tu batería cada día.
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="max-w-lg mx-auto w-full px-4 py-3">
        <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-1">
          {[
            { key: 'activities',  label: 'Actividades', emoji: '⚡' },
            { key: 'accessories', label: 'Accesorios',  emoji: '✨' },
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

      {/* Contenido */}
      <div className="max-w-lg mx-auto w-full px-4 pb-32 flex-1">

        {tab === 'activities' && (
          <div className="grid grid-cols-2 gap-3">
            {MASCOT_ACTIVITIES.map(activity => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                isUnlocked={unlocked.has(activity.id)}
                isActive={activeActivity === activity.id}
                canAfford={coins >= activity.price}
                onBuy={handleBuyActivity}
                onEquip={handleEquipActivity}
              />
            ))}
          </div>
        )}

        {tab === 'accessories' && (
          <div className="grid grid-cols-2 gap-3">
            {ACCESSORIES.map(item => (
              <AccessoryCard
                key={item.id}
                item={item}
                isOwned={ownedAcc.has(item.id)}
                canAfford={coins >= item.price}
                onBuy={handleBuyAccessory}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
