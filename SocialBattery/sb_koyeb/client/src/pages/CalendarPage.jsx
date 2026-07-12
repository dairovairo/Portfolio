import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { api } from '../lib/api';

// ── Date helpers ──────────────────────────────────────────────────────────────
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Genera la rejilla de un mes: array de semanas, cada una con 7 celdas
// { date, inMonth }. Empieza en lunes y rellena con días del mes
// anterior/siguiente para completar semanas enteras (rejilla rectangular).
function buildMonthGrid(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // lunes=0 ... domingo=6

  const gridStart = new Date(year, month, 1 - startWeekday);

  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    days.push({ date: d, inMonth: d.getMonth() === month });
  }

  // Recorta la última semana si es completamente del mes siguiente y no hace
  // falta (mantiene 5 filas cuando el mes cabe en 5, en vez de forzar 6).
  while (days.length > 35 && days.slice(-7).every(d => !d.inMonth)) {
    days.splice(-7, 7);
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function formatDayHeading(date) {
  return date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatItemTime(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ── Day detail sheet ──────────────────────────────────────────────────────────
function DayDetailSheet({ date, pools, events, onClose, onOpenPool, onOpenEvent }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-3xl max-h-[75vh] overflow-y-auto animate-slide-up pb-safe"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-card border-b border-surface-border px-5 py-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-surface-text capitalize">{formatDayHeading(date)}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full text-surface-muted hover:text-surface-text hover:bg-surface-hover flex items-center justify-center text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="p-5 pb-8 space-y-4">
          {pools.length === 0 && events.length === 0 && (
            <p className="text-sm text-surface-muted text-center py-6">Sin quedadas ni eventos este día.</p>
          )}

          {pools.length > 0 && (
            <div>
              <p className="text-[10px] font-display font-bold uppercase tracking-wide text-pink-400 mb-2">
                🌸 Quedadas
              </p>
              <div className="space-y-2">
                {pools.map(pool => (
                  <button
                    key={pool.id}
                    onClick={() => onOpenPool(pool.id)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-pink-400/10 border border-pink-400/25 hover:bg-pink-400/15 transition-colors"
                  >
                    <span className="text-sm font-display font-semibold text-surface-text truncate">{pool.title || 'Quedada'}</span>
                    <span className="flex-shrink-0 text-xs text-surface-muted font-mono">{formatItemTime(pool.date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div>
              <p className="text-[10px] font-display font-bold uppercase tracking-wide text-sky-400 mb-2">
                🌤️ Eventos
              </p>
              <div className="space-y-2">
                {events.map(ev => (
                  <button
                    key={ev.id}
                    onClick={() => onOpenEvent(ev.id)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-sky-400/10 border border-sky-400/25 hover:bg-sky-400/15 transition-colors"
                  >
                    <span className="text-sm font-display font-semibold text-surface-text truncate">{ev.title || 'Evento'}</span>
                    <span className="flex-shrink-0 text-xs text-surface-muted font-mono">{formatItemTime(ev.date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState([]);
  const [events, setEvents] = useState([]);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [poolsRes, eventsRes] = await Promise.all([
          api.get('/pools/calendar'),
          api.get('/community/events/calendar'),
        ]);
        if (cancelled) return;
        setPools(poolsRes?.pools || []);
        setEvents(eventsRes?.events || []);
      } catch (e) {
        console.error('[CalendarPage] load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Agrupa quedadas y eventos por día (clave YYYY-MM-DD en hora local).
  const itemsByDay = useMemo(() => {
    const map = new Map();
    const ensure = key => {
      if (!map.has(key)) map.set(key, { pools: [], events: [] });
      return map.get(key);
    };
    pools.forEach(p => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (Number.isNaN(d.getTime())) return;
      ensure(toDateKey(d)).pools.push(p);
    });
    events.forEach(ev => {
      if (!ev.date) return;
      const d = new Date(ev.date);
      if (Number.isNaN(d.getTime())) return;
      ensure(toDateKey(d)).events.push(ev);
    });
    return map;
  }, [pools, events]);

  const weeks = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);
  const today = new Date();

  function goToPrevMonth() {
    setMonthCursor(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function goToNextMonth() {
    setMonthCursor(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  function goToToday() {
    const now = new Date();
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  function dayClasses(dayInfo) {
    const key = toDateKey(dayInfo.date);
    const entry = itemsByDay.get(key);
    const hasPool = Boolean(entry?.pools?.length);
    const hasEvent = Boolean(entry?.events?.length);

    if (!dayInfo.inMonth) {
      return 'text-surface-muted/30 border-transparent';
    }
    if (hasPool && hasEvent) {
      return 'bg-purple-300/70 text-purple-950 border-purple-400/50 font-display font-bold';
    }
    if (hasPool) {
      return 'bg-pink-200/70 text-pink-950 border-pink-300/50 font-display font-semibold';
    }
    if (hasEvent) {
      return 'bg-sky-200/70 text-sky-950 border-sky-300/50 font-display font-semibold';
    }
    return 'text-surface-text border-surface-border/60 hover:border-accent-primary/40';
  }

  const selectedEntry = selectedDate ? itemsByDay.get(toDateKey(selectedDate)) : null;

  return (
    <div className="min-h-screen bg-surface-bg noise pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-lg">Calendario</h1>
            <p className="text-xs text-surface-muted font-mono">Tus quedadas y eventos</p>
          </div>
          <button
            onClick={goToToday}
            className="flex-shrink-0 text-xs font-display font-semibold px-3 py-1.5 rounded-lg border border-surface-border text-surface-muted hover:border-accent-primary/50 hover:text-surface-text transition-colors"
          >
            Hoy
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pt-4 space-y-4">
        {/* Month pager */}
        <div className="flex items-center justify-between">
          <button
            onClick={goToPrevMonth}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center hover:border-accent-primary/50 transition-colors"
            title="Mes anterior"
          >
            ‹
          </button>
          <h2 className="font-display font-bold text-surface-text text-base capitalize">
            {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
          </h2>
          <button
            onClick={goToNextMonth}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center hover:border-accent-primary/50 transition-colors"
            title="Mes siguiente"
          >
            ›
          </button>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-surface-muted bg-surface-card border border-surface-border rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-pink-200/70 border border-pink-300/50" />
            Quedada
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-sky-200/70 border border-sky-300/50" />
            Evento
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-purple-300/70 border border-purple-400/50" />
            Ambos
          </div>
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-3xl animate-pulse">📅</div>
            <p className="text-surface-muted font-mono text-sm">Cargando calendario...</p>
          </div>
        ) : (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-3">
            <div className="grid grid-cols-7 gap-1 mb-1.5">
              {WEEKDAY_LABELS.map(w => (
                <div key={w} className="text-center text-[10px] font-display font-bold text-surface-muted/70 py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((dayInfo, di) => {
                    const isToday = sameDay(dayInfo.date, today);
                    return (
                      <button
                        key={di}
                        type="button"
                        disabled={!dayInfo.inMonth}
                        onClick={() => setSelectedDate(dayInfo.date)}
                        className={`aspect-square rounded-xl border text-xs flex items-center justify-center transition-all active:scale-95 ${dayClasses(dayInfo)} ${
                          isToday ? 'ring-2 ring-accent-primary' : ''
                        }`}
                      >
                        {dayInfo.date.getDate()}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {selectedDate && (
        <DayDetailSheet
          date={selectedDate}
          pools={selectedEntry?.pools || []}
          events={selectedEntry?.events || []}
          onClose={() => setSelectedDate(null)}
          onOpenPool={(id) => navigate(`/pools/${id}/chat`)}
          onOpenEvent={(id) => navigate(`/community/event/${id}`)}
        />
      )}

      <BottomNav />
    </div>
  );
}
