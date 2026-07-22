import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Gráfico temporal para el dashboard de publicidad (fase 126)
// ─────────────────────────────────────────────────────────────────────────
// Un solo componente reutilizable que pinta la evolución de una métrica
// de un evento/sorteo/comunidad desde su creación hasta ahora. Se
// integra en las subpáginas CommunityDashboardEventPage y
// CommunityDashboardRafflePage.
//
// UI:
//   · Selector de métrica (píldoras) — las que aplican al entity
//   · Selector de intervalo (píldoras) — 5m/15m/1h/6h/1d/1w
//   · Toggle línea/barras
//   · SVG del gráfico con eje Y a la izquierda y eje X abajo
//   · Total del rango + intervalo elegido en texto bajo el gráfico
//
// Sin dependencias externas: SVG a mano. El proyecto mantiene el
// package.json muy delgado — meter recharts (~90 kB gz) para un solo
// gráfico simple no compensa. Todos los datos vienen del endpoint
// GET /communities/:id/dashboard/timeseries y se rellenan los huecos
// con 0 aquí (el server solo devuelve buckets con datos > 0).

// Métricas visibles según entity_type + condiciones (ej. banner Ultra
// solo si el evento es Ultra). Cada entry:
//   · key    — nombre técnico que va al server (metric=)
//   · label  — visible en la píldora
//   · show   — función opcional (entity) => bool para ocultar cuando
//              no aplica (ej. banner Ultra en Premium)
const METRIC_CATALOG = {
  event: [
    { key: 'sends',         label: '📤 Envíos push' },
    { key: 'clicks',        label: '👆 Clicks push' },
    { key: 'banner_views',  label: '🎨 Impresiones banner',
      show: (ev) => ev?.promotion_plan === 'ultra' },
    { key: 'banner_clicks', label: '🎨 Clicks banner',
      show: (ev) => ev?.promotion_plan === 'ultra' },
    { key: 'url_clicks',    label: '🔗 Clicks al enlace',
      show: (ev) => !!ev?.url },
  ],
  raffle: [
    { key: 'targets', label: '🎯 Asignados' },
    { key: 'shown',   label: '📢 Enseñados' },
    { key: 'clicks',  label: '👆 Clicks banner' },
  ],
  community: [
    { key: 'url_clicks', label: '🔗 Clicks al enlace' },
  ],
};

const INTERVALS = [
  { key: '5m',  label: '5 min', seconds: 300 },
  { key: '15m', label: '15 min', seconds: 900 },
  { key: '1h',  label: '1 h',   seconds: 3600 },
  { key: '6h',  label: '6 h',   seconds: 21600 },
  { key: '1d',  label: '1 día', seconds: 86400 },
  { key: '1w',  label: '1 sem', seconds: 604800 },
];

// Elige un intervalo por defecto basado en la vida del entity: si es
// nuevo (< 6h) usa 15m para no ver una barra sola en un océano vacío;
// si tiene más de 3 días, ve por día. Puntos intermedios: 1h.
function pickDefaultInterval(fromIso) {
  if (!fromIso) return '1h';
  const ageMs = Date.now() - new Date(fromIso).getTime();
  const h = ageMs / 3600000;
  if (h < 6)   return '15m';
  if (h < 72)  return '1h';
  if (h < 720) return '1d';
  return '1w';
}

// Rellena los huecos entre buckets del server con 0. El server solo
// devuelve buckets con value > 0 para ahorrar bytes. Aquí generamos
// TODA la serie alineada al bucket, para que línea/barras se pinten
// contiguas sin gaps engañosos.
function fillGaps(buckets, from, to, bucketSeconds) {
  const bucketMs = bucketSeconds * 1000;
  const start = Math.floor(new Date(from).getTime() / bucketMs) * bucketMs;
  const end   = Math.floor(new Date(to).getTime()   / bucketMs) * bucketMs;
  const byTs = new Map();
  for (const b of buckets) byTs.set(new Date(b.ts).getTime(), b.value);
  const out = [];
  for (let t = start; t <= end; t += bucketMs) {
    out.push({ ts: t, value: byTs.get(t) || 0 });
  }
  return out;
}

// Etiqueta corta para el eje X según intervalo. Se usa un formato
// distinto para intervalos <1d (muestra hora) vs >=1d (muestra fecha).
function formatTick(ts, intervalKey) {
  const d = new Date(ts);
  if (intervalKey === '1w' || intervalKey === '1d') {
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }
  const day = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

function formatTooltipTs(ts, intervalKey) {
  const d = new Date(ts);
  const day = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  if (intervalKey === '1w' || intervalKey === '1d') return day;
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

function fmtCompact(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

export default function TimeseriesChart({
  communityId, entityType, entityId, entity,
}) {
  const catalog = useMemo(
    () => (METRIC_CATALOG[entityType] || []).filter(m => !m.show || m.show(entity)),
    [entityType, entity],
  );

  const [metric,   setMetric]   = useState(catalog[0]?.key || null);
  const [intervalKey, setIntervalKey] = useState(() => pickDefaultInterval(entity?.created_at));
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'line'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  // Si cambia el catálogo (p.ej. porque el entity cargó tarde) y la
  // métrica seleccionada ya no aplica, saltamos a la primera disponible.
  useEffect(() => {
    if (metric && !catalog.some(m => m.key === metric)) {
      setMetric(catalog[0]?.key || null);
    } else if (!metric && catalog.length) {
      setMetric(catalog[0].key);
    }
  }, [catalog, metric]);

  const load = useCallback(async () => {
    if (!metric || !entityId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: entityId,
        metric,
        interval: intervalKey,
      });
      const res = await api.get(
        `/community/communities/${communityId}/dashboard/timeseries?${params.toString()}`
      );
      setData(res);
    } catch (e) {
      setError(e.message || 'No se pudo cargar el gráfico');
    } finally {
      setLoading(false);
    }
  }, [communityId, entityType, entityId, metric, intervalKey]);

  useEffect(() => { load(); }, [load]);

  // Serie completa (con huecos rellenos a 0) y máximo para escalar Y.
  const series = useMemo(() => {
    if (!data) return [];
    return fillGaps(data.buckets, data.from, data.to, data.bucket_seconds);
  }, [data]);
  const maxValue = useMemo(() => Math.max(1, ...series.map(p => p.value)), [series]);
  const total    = useMemo(() => series.reduce((a, p) => a + p.value, 0), [series]);

  // Layout del SVG. Se calcula relativo al viewBox — el CSS lo estira
  // al ancho disponible. Deja hueco para eje Y y eje X.
  const VBW = 620, VBH = 240;
  const PAD_L = 40, PAD_R = 12, PAD_T = 12, PAD_B = 32;
  const plotW = VBW - PAD_L - PAD_R;
  const plotH = VBH - PAD_T - PAD_B;

  const [hover, setHover] = useState(null); // idx del punto sobre el que estamos, o null

  const xForIdx = useCallback(
    (i) => series.length <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (series.length - 1)) * plotW,
    [series.length, plotW],
  );
  const yForVal = useCallback(
    (v) => PAD_T + plotH - (v / maxValue) * plotH,
    [maxValue, plotH],
  );

  // Ticks del eje X: máximo 5 etiquetas, elegidas equidistantes.
  const xTicks = useMemo(() => {
    if (!series.length) return [];
    const n = Math.min(5, series.length);
    const step = Math.max(1, Math.floor((series.length - 1) / (n - 1 || 1)));
    const out = [];
    for (let i = 0; i < series.length; i += step) out.push(i);
    if (out[out.length - 1] !== series.length - 1) out.push(series.length - 1);
    return out;
  }, [series]);

  // Ticks del eje Y: 4 líneas equidistantes desde 0 al máximo.
  const yTicks = useMemo(() => {
    const n = 4;
    const out = [];
    for (let i = 0; i <= n; i++) out.push(Math.round((maxValue * i) / n));
    return out;
  }, [maxValue]);

  // Path de la línea (SVG "M x y L x y ..."). Solo tiene sentido si hay
  // al menos 2 puntos con datos; con 0 o 1 pinto barras siempre.
  const linePath = useMemo(() => {
    if (chartType !== 'line' || series.length < 2) return '';
    return series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xForIdx(i).toFixed(2)} ${yForVal(p.value).toFixed(2)}`)
      .join(' ');
  }, [series, chartType, xForIdx, yForVal]);

  const effectiveType = chartType === 'line' && series.length < 2 ? 'bar' : chartType;

  if (!catalog.length) {
    return (
      <section className="bg-surface-card border border-surface-border rounded-2xl p-4 text-[11px] font-mono text-surface-muted">
        No hay métricas temporales para este {entityType === 'raffle' ? 'sorteo' : entityType === 'event' ? 'evento' : 'ítem'}.
      </section>
    );
  }

  return (
    <section className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-surface-text text-sm">📈 Evolución en el tiempo</h2>
        <div className="flex items-center gap-1 text-[10px] font-mono">
          <button
            onClick={() => setChartType('bar')}
            className={`px-2 py-1 rounded-md border transition-colors ${
              effectiveType === 'bar'
                ? 'bg-accent-primary/15 text-accent-glow border-accent-primary/30'
                : 'bg-surface-bg text-surface-muted border-surface-border hover:text-surface-text'
            }`}
          >Barras</button>
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-1 rounded-md border transition-colors ${
              effectiveType === 'line'
                ? 'bg-accent-primary/15 text-accent-glow border-accent-primary/30'
                : 'bg-surface-bg text-surface-muted border-surface-border hover:text-surface-text'
            }`}
          >Línea</button>
        </div>
      </div>

      {/* Selector de métrica */}
      <div className="flex items-center flex-wrap gap-1.5">
        {catalog.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-2.5 py-1 rounded-full border text-[10px] font-mono transition-colors ${
              metric === m.key
                ? 'bg-accent-primary/15 text-accent-glow border-accent-primary/30'
                : 'bg-surface-bg text-surface-muted border-surface-border hover:text-surface-text'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Selector de intervalo */}
      <div className="flex items-center flex-wrap gap-1.5">
        <span className="text-[10px] font-mono text-surface-muted mr-1">Bucket:</span>
        {INTERVALS.map(iv => (
          <button
            key={iv.key}
            onClick={() => setIntervalKey(iv.key)}
            className={`px-2 py-0.5 rounded-md border text-[10px] font-mono transition-colors ${
              intervalKey === iv.key
                ? 'bg-surface-text/10 text-surface-text border-surface-text/20'
                : 'bg-surface-bg text-surface-muted border-surface-border hover:text-surface-text'
            }`}
          >
            {iv.label}
          </button>
        ))}
      </div>

      {/* Gráfico */}
      <div className="relative bg-surface-bg border border-surface-border rounded-xl p-2">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-bg/60 backdrop-blur-sm rounded-xl z-10">
            <p className="text-[11px] font-mono text-surface-muted">Cargando…</p>
          </div>
        )}
        {error ? (
          <div className="text-center py-8">
            <p className="text-[11px] font-mono text-red-300 mb-2">{error}</p>
            <button onClick={load} className="text-[10px] font-mono text-accent-glow underline">Reintentar</button>
          </div>
        ) : !series.length ? (
          <div className="text-center py-8 text-[11px] font-mono text-surface-muted">
            Sin datos en el rango.
          </div>
        ) : (
          <svg viewBox={`0 0 ${VBW} ${VBH}`} className="w-full h-52" role="img" aria-label="Gráfico temporal">
            {/* Líneas guía del eje Y + etiquetas */}
            {yTicks.map((v, i) => (
              <g key={i}>
                <line
                  x1={PAD_L} x2={VBW - PAD_R}
                  y1={yForVal(v)} y2={yForVal(v)}
                  stroke="currentColor" className="text-surface-border/40"
                  strokeDasharray={i === 0 ? '' : '2,3'}
                  strokeWidth="0.5"
                />
                <text
                  x={PAD_L - 4} y={yForVal(v) + 3}
                  textAnchor="end" fontSize="9"
                  className="fill-current text-surface-muted font-mono"
                >
                  {fmtCompact(v)}
                </text>
              </g>
            ))}
            {/* Etiquetas del eje X */}
            {xTicks.map((i) => (
              <text
                key={i}
                x={xForIdx(i)} y={VBH - PAD_B + 14}
                textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
                fontSize="9"
                className="fill-current text-surface-muted font-mono"
              >
                {formatTick(series[i].ts, intervalKey)}
              </text>
            ))}

            {/* Barras */}
            {effectiveType === 'bar' && (
              <>
                {series.map((p, i) => {
                  const bw = Math.max(1, plotW / series.length - 2);
                  const bx = xForIdx(i) - bw / 2;
                  const by = yForVal(p.value);
                  const bh = plotH - (by - PAD_T);
                  const isHover = hover === i;
                  return (
                    <rect
                      key={i}
                      x={bx} y={by} width={bw} height={Math.max(0, bh)}
                      className={isHover ? 'fill-accent-glow' : 'fill-accent-primary/60'}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </>
            )}

            {/* Línea + puntos */}
            {effectiveType === 'line' && (
              <>
                <path d={linePath} fill="none" stroke="currentColor" strokeWidth="1.75"
                      className="text-accent-primary" strokeLinejoin="round" strokeLinecap="round" />
                {series.map((p, i) => (
                  <circle
                    key={i}
                    cx={xForIdx(i)} cy={yForVal(p.value)}
                    r={hover === i ? 4 : 2.5}
                    className={hover === i ? 'fill-accent-glow' : 'fill-accent-primary'}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </>
            )}

            {/* Tooltip: rectángulo negro con la fecha y el valor sobre
                el punto hover. Se pinta al final para quedar encima. */}
            {hover != null && series[hover] && (() => {
              const px = xForIdx(hover);
              const py = yForVal(series[hover].value);
              const label = `${formatTooltipTs(series[hover].ts, intervalKey)} · ${fmtCompact(series[hover].value)}`;
              // Estimación del ancho para no salirse por la izquierda o
              // por la derecha del viewBox. Cada char ≈ 5.2px a fontSize=9.
              const w = Math.min(220, Math.max(80, label.length * 5.2 + 12));
              let x = px - w / 2;
              if (x < PAD_L) x = PAD_L;
              if (x + w > VBW - PAD_R) x = VBW - PAD_R - w;
              const y = Math.max(PAD_T, py - 22);
              return (
                <g pointerEvents="none">
                  <rect x={x} y={y} width={w} height={18} rx={4} className="fill-surface-card stroke-surface-border" strokeWidth="0.5" />
                  <text x={x + w/2} y={y + 12} textAnchor="middle" fontSize="9"
                    className="fill-current text-surface-text font-mono">{label}</text>
                </g>
              );
            })()}
          </svg>
        )}
      </div>

      {/* Pie: totales + nota */}
      {data && (
        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-surface-muted">
          <span>Total en el rango: <span className="text-accent-glow font-bold">{fmtCompact(total)}</span></span>
          <span>desde {new Date(data.from).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
        </div>
      )}
      <p className="text-[10px] text-surface-muted leading-relaxed">
        Los gráficos de <span className="text-surface-text">envíos</span> y <span className="text-surface-text">clicks push</span> arrancan
        desde la primera notificación del evento. Los de <span className="text-surface-text">banner Ultra</span> y <span className="text-surface-text">clicks a enlaces</span> solo
        cubren desde que se activó el registro detallado (fase 126 en adelante), aunque el total acumulado del contador principal puede incluir datos anteriores.
      </p>
    </section>
  );
}
