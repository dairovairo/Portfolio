import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * GlobeLocationView — "bola del mundo" interactiva para EventLocatorPage.
 *
 * Dos modos:
 *  - 'globe': globo 3D nocturno (globe.gl / three.js vía CDN) con vuelo
 *    cinematográfico hasta el pin del evento, atmósfera con el color de
 *    acento del tema activo y anillos de pulso sobre la ubicación.
 *  - 'map': mapa 2D detallado (Leaflet) con teselas oscuras o claras según
 *    el tema de la app (CARTO dark_all / light_all — sin API key).
 *
 * Props:
 *   lat, lng {number}
 *   label    {string|null}
 */

const GLOBE_JS       = 'https://unpkg.com/globe.gl';
const EARTH_NIGHT_IMG = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
const EARTH_BUMP_IMG  = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const NIGHT_SKY_IMG    = 'https://unpkg.com/three-globe/example/img/night-sky.png';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js';

let globeLoadPromise = null;
function loadGlobeGL() {
  if (globeLoadPromise) return globeLoadPromise;
  globeLoadPromise = new Promise((resolve, reject) => {
    if (window.Globe) { resolve(window.Globe); return; }
    const script = document.createElement('script');
    script.src = GLOBE_JS;
    script.onload = () => resolve(window.Globe);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return globeLoadPromise;
}

let leafletLoadPromise = null;
function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    if (window.L) { resolve(window.L); return; }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

let pinStyleInjected = false;
function ensurePinStyles() {
  if (pinStyleInjected) return;
  pinStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sb-pin-pulse {
      0%   { transform: scale(0.6); opacity: 0.85; }
      70%  { transform: scale(2.6); opacity: 0; }
      100% { transform: scale(2.6); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function makePinEl(color) {
  ensurePinStyles();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;';
  wrap.innerHTML = `
    <div style="position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:9999px;background:${color};opacity:0.55;animation:sb-pin-pulse 1.8s ease-out infinite;"></div>
    <div style="position:absolute;left:-13px;top:-31px;font-size:24px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.7));">📍</div>
  `;
  return wrap;
}

function rgbTriplet(cssColor, fallback = '45,212,220') {
  const m = /rgb\(([^)]+)\)/.exec(cssColor || '');
  return m ? m[1].replace(/\s+/g, '') : fallback;
}

// ── Modo globo 3D ────────────────────────────────────────────────────────
function GlobeView({ lat, lng }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    let resizeObserver;

    loadGlobeGL().then(Globe => {
      if (cancelled || !containerRef.current || globeRef.current) return;
      const el = containerRef.current;

      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--sb-accent-glow').trim() || 'rgb(45, 212, 220)';
      const triplet = rgbTriplet(accent);

      const world = Globe()(el)
        .globeImageUrl(EARTH_NIGHT_IMG)
        .bumpImageUrl(EARTH_BUMP_IMG)
        .backgroundImageUrl(NIGHT_SKY_IMG)
        .showAtmosphere(true)
        .atmosphereColor(accent)
        .atmosphereAltitude(0.22)
        .pointsData([{ lat, lng }])
        .pointColor(() => accent)
        .pointAltitude(0.005)
        .pointRadius(0.35)
        .ringsData([{ lat, lng }])
        .ringColor(() => t => `rgba(${triplet},${1 - t})`)
        .ringMaxRadius(4.5)
        .ringPropagationSpeed(2.2)
        .ringRepeatPeriod(1400)
        .htmlElementsData([{ lat, lng }])
        .htmlElement(() => makePinEl(accent))
        .width(el.clientWidth)
        .height(el.clientHeight);

      const controls = world.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.7;
      controls.enableZoom = true;
      controls.minDistance = 120;
      controls.maxDistance = 420;

      // Vista alejada inicial, luego "vuelo" cinematográfico hacia el pin
      world.pointOfView({ lat, lng, altitude: 2.4 }, 0);
      const flyTimer = setTimeout(() => {
        if (!cancelled) world.pointOfView({ lat, lng, altitude: 0.55 }, 2600);
      }, 350);

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current) return;
        world.width(containerRef.current.clientWidth);
        world.height(containerRef.current.clientHeight);
      });
      resizeObserver.observe(el);

      globeRef.current = world;
      globeRef.current._flyTimer = flyTimer;
      setReady(true);
    }).catch(() => setErr('No se pudo cargar el globo'));

    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (globeRef.current) {
        clearTimeout(globeRef.current._flyTimer);
        try { globeRef.current._destructor?.(); } catch { /* noop */ }
        globeRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <div className="relative w-full h-full">
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050510] z-10">
          <div className="flex flex-col items-center gap-2 text-surface-muted">
            <div className="w-5 h-5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            <span className="text-xs font-mono">Cargando globo…</span>
          </div>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050510] text-xs text-slate-500 font-mono px-4 text-center">
          {err}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ── Modo mapa 2D detallado (oscuro/claro según tema) ────────────────────
function FlatMapView({ lat, lng, label, isDark }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: true,
      });

      const tileUrl = isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      L.tileLayer(tileUrl, { maxZoom: 19, subdomains: 'abcd' }).addTo(map);

      const icon = L.divIcon({
        html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">📍</div>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -32],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      if (label) {
        marker.bindPopup(
          `<span style="font-size:12px;font-family:monospace;white-space:normal;max-width:200px;display:block">${label}</span>`,
          { maxWidth: 220 }
        );
      }

      mapRef.current = map;
      setReady(true);
    }).catch(() => setErr('No se pudo cargar el mapa'));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, isDark]);

  return (
    <div className="relative w-full h-full">
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-bg z-10">
          <div className="flex flex-col items-center gap-2 text-surface-muted">
            <div className="w-5 h-5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            <span className="text-xs font-mono">Cargando mapa…</span>
          </div>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-bg text-xs text-slate-500 font-mono">
          {err}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────
export default function GlobeLocationView({ lat, lng, label }) {
  const { isDark } = useTheme();
  const [mode, setMode] = useState('globe'); // 'globe' | 'map'

  if (lat == null || lng == null) return null;

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
      <div className="relative" style={{ height: 260 }}>
        {mode === 'globe'
          ? <GlobeView key="globe" lat={lat} lng={lng} />
          : <FlatMapView key="map" lat={lat} lng={lng} label={label} isDark={isDark} />}

        <div className="absolute top-2.5 right-2.5 z-20 flex bg-black/40 backdrop-blur-md border border-white/10 rounded-full p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setMode('globe')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-display font-semibold transition-colors ${
              mode === 'globe' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
            }`}
          >
            🌍 Globo
          </button>
          <button
            type="button"
            onClick={() => setMode('map')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-display font-semibold transition-colors ${
              mode === 'map' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
            }`}
          >
            🗺️ Mapa
          </button>
        </div>
      </div>

      {label && (
        <div className="px-4 py-2.5 border-t border-surface-border flex items-center gap-2">
          <span className="text-sm">📍</span>
          <span className="text-xs font-mono text-surface-muted truncate">{label}</span>
        </div>
      )}
    </div>
  );
}
