import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';

// ── Catálogo de la tienda ─────────────────────────────────────────────────────

const ACTIVITIES = [
  { id: 'act_walk',    name: 'Paseo matutino',     emoji: '🌅', price: 50,  desc: 'Tu mascota sale a explorar el barrio al amanecer.' },
  { id: 'act_swim',    name: 'Clases de natación',  emoji: '🏊', price: 80,  desc: 'Aprende a nadar en la piscina municipal.' },
  { id: 'act_yoga',    name: 'Yoga relajante',      emoji: '🧘', price: 60,  desc: 'Sesión de yoga para recargar energías sociales.' },
  { id: 'act_dance',   name: 'Clase de baile',      emoji: '💃', price: 90,  desc: 'Aprende nuevos pasos y haz amigos en la pista.' },
  { id: 'act_game',    name: 'Tarde de juegos',     emoji: '🎮', price: 40,  desc: 'Sesión de videojuegos en el salón recreativo.' },
  { id: 'act_hike',    name: 'Senderismo',          emoji: '🥾', price: 70,  desc: 'Ruta por la sierra para desconectar.' },
  { id: 'act_read',    name: 'Club de lectura',     emoji: '📚', price: 30,  desc: 'Tarde tranquila en la librería del barrio.' },
  { id: 'act_cook',    name: 'Taller de cocina',    emoji: '🍳', price: 100, desc: 'Aprende a cocinar platos nuevos con amigos.' },
  { id: 'act_paint',   name: 'Clase de pintura',    emoji: '🎨', price: 75,  desc: 'Expresa tu creatividad en el taller de arte.' },
  { id: 'act_music',   name: 'Concierto en vivo',   emoji: '🎵', price: 120, desc: 'Disfruta de un concierto íntimo en el barrio.' },
];

const ACCESSORIES = [
  { id: 'acc_hat',     name: 'Gorra chula',         emoji: '🧢', price: 45,  desc: 'Un look urbano para salir con estilo.' },
  { id: 'acc_glasses', name: 'Gafas de sol',        emoji: '😎', price: 60,  desc: 'Protección solar y estilo en uno.' },
  { id: 'acc_scarf',   name: 'Bufanda de colores',  emoji: '🧣', price: 35,  desc: 'Colorida y cálida para los días fríos.' },
  { id: 'acc_bag',     name: 'Mochila viajera',     emoji: '🎒', price: 90,  desc: 'Para llevar todo lo necesario en cada aventura.' },
  { id: 'acc_headph',  name: 'Auriculares',         emoji: '🎧', price: 110, desc: 'Música en cualquier momento y lugar.' },
  { id: 'acc_star',    name: 'Pin de estrella',     emoji: '⭐', price: 20,  desc: 'Un pequeño detalle que lo dice todo.' },
  { id: 'acc_heart',   name: 'Pin de corazón',      emoji: '❤️', price: 20,  desc: 'Lleva el amor a todas partes.' },
  { id: 'acc_crown',   name: 'Corona dorada',       emoji: '👑', price: 200, desc: 'Para quienes reinan en lo social.' },
  { id: 'acc_balloon', name: 'Globos de fiesta',    emoji: '🎈', price: 25,  desc: 'Siempre es momento de celebrar.' },
  { id: 'acc_camera',  name: 'Cámara instax',       emoji: '📸', price: 130, desc: 'Captura los mejores momentos con amigos.' },
];

// ── Moneda ficticia (por ahora solo UI) ──────────────────────────────────────
const COINS = 340; // placeholder

function ItemCard({ item, owned, onBuy }) {
  return (
    <div
      className={`bg-surface-card border rounded-2xl p-4 flex flex-col gap-2 transition-all duration-200
        ${owned ? 'border-accent-primary/40 opacity-70' : 'border-surface-border hover:border-accent-primary/30'}`}
    >
      <div className="text-4xl text-center" style={{ fontVariantEmoji: 'emoji' }}>{item.emoji}</div>
      <div className="text-center">
        <div className="font-display font-bold text-surface-text text-sm leading-tight">{item.name}</div>
        <div className="text-surface-muted text-[11px] mt-1 leading-snug">{item.desc}</div>
      </div>
      <div className="mt-auto pt-1">
        {owned ? (
          <div className="w-full text-center text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 rounded-xl py-2">
            ✓ En tu colección
          </div>
        ) : (
          <button
            onClick={() => onBuy(item)}
            disabled={COINS < item.price}
            className={`w-full py-2 rounded-xl text-xs font-display font-semibold transition-all duration-200
              ${COINS >= item.price
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

export default function ShopPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('activities');
  const [owned, setOwned] = useState(new Set());
  const [toast, setToast] = useState(null);

  function handleBuy(item) {
    setOwned(prev => new Set([...prev, item.id]));
    setToast(`¡${item.name} añadido a tu colección! 🎉`);
    setTimeout(() => setToast(null), 2500);
  }

  const items = tab === 'activities' ? ACTIVITIES : ACCESSORIES;

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-primary text-white px-5 py-3
          rounded-2xl text-sm font-display font-semibold shadow-lg shadow-accent-primary/30 animate-slide-down">
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
            <span className="text-xl">🛒</span>
            <span className="font-display font-bold text-surface-text">Tienda de la mascota</span>
          </div>
          {/* Coin balance */}
          <div className="flex items-center gap-1 bg-surface-card border border-surface-border rounded-xl px-3 py-1.5">
            <span className="text-sm">🪙</span>
            <span className="font-mono font-bold text-accent-glow text-sm">{COINS}</span>
          </div>
        </div>
      </nav>

      {/* Mascot banner */}
      <div className="max-w-lg mx-auto w-full px-4 pt-5 pb-2">
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-4">
          <img
            src="/mascot-high.png"
            alt="Mascota"
            className="w-16 h-16 object-contain"
          />
          <div>
            <div className="font-display font-bold text-surface-text text-sm">¡Bienvenido a la tienda!</div>
            <div className="text-surface-muted text-xs mt-0.5 leading-snug">
              Personaliza tu mascota con actividades y accesorios únicos.
              Ganas monedas actualizando tu batería cada día.
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="max-w-lg mx-auto w-full px-4 py-3">
        <div className="flex bg-surface-card border border-surface-border rounded-2xl p-1 gap-1">
          {[
            { key: 'activities', label: 'Actividades', emoji: '⚡' },
            { key: 'accessories', label: 'Accesorios',  emoji: '✨' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-display font-semibold transition-all duration-200
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

      {/* Items grid */}
      <div className="max-w-lg mx-auto w-full px-4 pb-32">
        <div className="grid grid-cols-2 gap-3">
          {items.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              owned={owned.has(item.id)}
              onBuy={handleBuy}
            />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
