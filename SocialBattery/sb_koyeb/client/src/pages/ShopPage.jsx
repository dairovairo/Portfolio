import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';

// ── Catálogo ──────────────────────────────────────────────────────────────────

const ACTIVIDADES = [
  {
    id: 'act-1',
    emoji: '🎟️',
    name: 'Pack Noche de Cine',
    desc: 'Acceso para 2 personas + palomitas + refresco en cines seleccionados.',
    price: 24.99,
    badge: 'Popular',
    badgeColor: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  },
  {
    id: 'act-2',
    emoji: '🧗',
    name: 'Sesión de Escalada',
    desc: 'Entrada de día en rocódromo con alquiler de pies de gato incluido.',
    price: 18.50,
    badge: 'Nuevo',
    badgeColor: 'text-green-400 bg-green-400/10 border-green-400/20',
  },
  {
    id: 'act-3',
    emoji: '🍳',
    name: 'Taller de Cocina',
    desc: 'Clase grupal de 2h con chef profesional. Ingredientes incluidos.',
    price: 35.00,
    badge: null,
    badgeColor: '',
  },
  {
    id: 'act-4',
    emoji: '🎨',
    name: 'Tarde de Pintura',
    desc: 'Sesión de 3h de pintura guiada. Material y bebida incluidos.',
    price: 29.00,
    badge: 'Oferta',
    badgeColor: 'text-red-400 bg-red-400/10 border-red-400/20',
  },
  {
    id: 'act-5',
    emoji: '🧘',
    name: 'Retiro de Yoga',
    desc: 'Jornada completa de yoga y meditación en entorno natural.',
    price: 45.00,
    badge: null,
    badgeColor: '',
  },
  {
    id: 'act-6',
    emoji: '🎮',
    name: 'LAN Party Premium',
    desc: 'Reserva de sala gaming para hasta 8 jugadores durante 4 horas.',
    price: 59.90,
    badge: 'Nuevo',
    badgeColor: 'text-green-400 bg-green-400/10 border-green-400/20',
  },
];

const ACCESORIOS = [
  {
    id: 'acc-1',
    emoji: '🔋',
    name: 'Pin SocialBattery',
    desc: 'Pin metálico esmaltado con el logo de la app. Edición limitada.',
    price: 8.99,
    badge: 'Limitado',
    badgeColor: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  },
  {
    id: 'acc-2',
    emoji: '👕',
    name: 'Camiseta Volty',
    desc: 'Camiseta de algodón 100% con la mascota Volty bordada. Tallas S–XL.',
    price: 22.00,
    badge: 'Popular',
    badgeColor: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  },
  {
    id: 'acc-3',
    emoji: '🧢',
    name: 'Gorra SocialBattery',
    desc: 'Gorra de béisbol ajustable con logo bordado. Color negro mate.',
    price: 19.50,
    badge: null,
    badgeColor: '',
  },
  {
    id: 'acc-4',
    emoji: '🎒',
    name: 'Mochila Energía',
    desc: 'Mochila urbana de 20L con puerto USB integrado. Color gris.',
    price: 49.00,
    badge: 'Nuevo',
    badgeColor: 'text-green-400 bg-green-400/10 border-green-400/20',
  },
  {
    id: 'acc-5',
    emoji: '☕',
    name: 'Termo Batería Llena',
    desc: 'Termo de acero inoxidable 500ml. Mantiene temperatura 12h.',
    price: 27.00,
    badge: 'Oferta',
    badgeColor: 'text-red-400 bg-red-400/10 border-red-400/20',
  },
  {
    id: 'acc-6',
    emoji: '📒',
    name: 'Libreta Social',
    desc: 'Libreta A5 con cubierta de SocialBattery y páginas punteadas.',
    price: 12.99,
    badge: null,
    badgeColor: '',
  },
];

// ── Subcomponente tarjeta de producto ─────────────────────────────────────────

function ProductCard({ item }) {
  const [added, setAdded] = useState(false);

  function handleAdd() {
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 flex flex-col gap-3
      hover:border-accent-primary/30 transition-all duration-200">
      {/* Emoji + badge */}
      <div className="flex items-start justify-between">
        <span className="text-4xl">{item.emoji}</span>
        {item.badge && (
          <span className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full border ${item.badgeColor}`}>
            {item.badge}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="font-display font-bold text-surface-text text-sm leading-snug mb-1">
          {item.name}
        </h3>
        <p className="text-xs text-surface-muted leading-relaxed">
          {item.desc}
        </p>
      </div>

      {/* Price + CTA */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-bold text-accent-glow text-base">
          {item.price.toFixed(2)} €
        </span>
        <button
          onClick={handleAdd}
          className={`px-3 py-1.5 rounded-xl text-xs font-display font-semibold transition-all duration-200
            ${added
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-accent-primary/15 text-accent-glow border border-accent-primary/30 hover:bg-accent-primary/25'
            }`}
        >
          {added ? '✓ Añadido' : 'Añadir'}
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ShopPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('actividades');

  const items = tab === 'actividades' ? ACTIVIDADES : ACCESORIOS;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-surface-muted hover:text-surface-text transition-colors p-1"
          >
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1">Tienda</h1>
          <span className="text-xl">🛒</span>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">

        {/* Banner */}
        <div
          className="rounded-2xl p-5 text-center relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, var(--sb-accent)20 0%, var(--sb-card) 100%)' }}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-2 left-6 text-5xl opacity-10">⚡</div>
            <div className="absolute bottom-2 right-6 text-5xl opacity-10">🔋</div>
          </div>
          <p className="text-xs font-mono text-surface-muted uppercase tracking-widest mb-1">Próximamente</p>
          <h2 className="font-display font-bold text-surface-text text-lg mb-1">La tienda SocialBattery</h2>
          <p className="text-xs text-surface-muted max-w-xs mx-auto">
            Actividades para hacer con tus amigos y accesorios exclusivos de la app. ¡Muy pronto disponibles!
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex gap-2 bg-surface-card border border-surface-border rounded-2xl p-1">
          {[
            { id: 'actividades', emoji: '🎯', label: 'Actividades' },
            { id: 'accesorios',  emoji: '🎁', label: 'Accesorios' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-display font-semibold transition-all duration-200
                ${tab === t.id
                  ? 'bg-accent-primary text-white shadow-sm shadow-accent-primary/20'
                  : 'text-surface-muted hover:text-surface-text'
                }`}
            >
              <span>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Section header */}
        <div className="flex items-center gap-2">
          <h2 className="font-display font-bold text-surface-text text-sm uppercase tracking-wider">
            {tab === 'actividades' ? '🎯 Actividades' : '🎁 Accesorios'}
          </h2>
          <div className="flex-1 h-px bg-surface-border" />
          <span className="text-xs text-surface-muted font-mono">{items.length} artículos</span>
        </div>

        {/* Products grid */}
        <div className="grid grid-cols-2 gap-3">
          {items.map(item => (
            <ProductCard key={item.id} item={item} />
          ))}
        </div>

        {/* Footer note */}
        <div className="text-center py-4">
          <p className="text-xs text-surface-muted/60">
            La tienda está en desarrollo — los precios son orientativos y los productos no están disponibles aún.
          </p>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
