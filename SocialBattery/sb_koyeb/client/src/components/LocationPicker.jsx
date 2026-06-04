import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default marker icon paths broken by bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

/**
 * LocationPicker — selección de ubicación con mapa interactivo.
 *
 * Props:
 *   value    {string}       — texto de dirección actual (form.location)
 *   lat      {number|null}
 *   lng      {number|null}
 *   onChange (location, lat, lng) => void
 *
 * Usa Leaflet (npm) + OpenStreetMap + Nominatim.
 * No requiere API key.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export default function LocationPicker({ value, lat, lng, onChange }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef  = useRef(null);
  const markerRef       = useRef(null);
  const ignoreNextRef   = useRef(false);

  const [query,       setQuery]       = useState(value || '');
  const [searching,   setSearching]   = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [mapReady,    setMapReady]    = useState(false);
  const [error,       setError]       = useState('');
  const debounceRef   = useRef(null);

  // ── 1. Inicializar mapa ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat  = lat  ?? 40.4168;
    const initialLng  = lng  ?? -3.7038;
    const initialZoom = (lat && lng) ? 15 : 5;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: initialZoom,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Icono personalizado acorde al tema oscuro
    const customIcon = L.divIcon({
      html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">📍</div>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -30],
    });

    // Si ya hay coordenadas, poner marcador
    if (lat && lng) {
      markerRef.current = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    }

    // Clic en el mapa → reverse geocode
    map.on('click', async (e) => {
      const { lat: clickLat, lng: clickLng } = e.latlng;

      if (markerRef.current) {
        markerRef.current.setLatLng([clickLat, clickLng]);
      } else {
        markerRef.current = L.marker([clickLat, clickLng], { icon: customIcon }).addTo(map);
      }

      try {
        ignoreNextRef.current = true;
        setSearching(true);
        setError('');
        const res = await fetch(
          `${NOMINATIM}/reverse?lat=${clickLat}&lon=${clickLng}&format=json&accept-language=es`,
          { headers: { 'Accept-Language': 'es' } }
        );
        const data = await res.json();
        const address = data.display_name || `${clickLat.toFixed(5)}, ${clickLng.toFixed(5)}`;
        setQuery(address);
        setSuggestions([]);
        onChange(address, clickLat, clickLng);
      } catch {
        const fallback = `${clickLat.toFixed(5)}, ${clickLng.toFixed(5)}`;
        setQuery(fallback);
        onChange(fallback, clickLat, clickLng);
      } finally {
        setSearching(false);
        ignoreNextRef.current = false;
      }
    });

    mapInstanceRef.current = map;
    setMapReady(true);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Cuando llegan lat/lng desde fuera → mover mapa y marcador ──────────
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (lat == null || lng == null) return;

    mapInstanceRef.current.setView([lat, lng], 15, { animate: true });

    const customIcon = L.divIcon({
      html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">📍</div>',
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { icon: customIcon }).addTo(mapInstanceRef.current);
    }
  }, [lat, lng, mapReady]);

  // ── 3. Búsqueda con debounce ───────────────────────────────────────────────
  const handleQueryChange = useCallback((e) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v, null, null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (ignoreNextRef.current) return;
    if (v.trim().length < 3) { setSuggestions([]); return; }

    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        setError('');
        const res = await fetch(
          `${NOMINATIM}/search?q=${encodeURIComponent(v)}&format=json&limit=5&accept-language=es`,
          { headers: { 'Accept-Language': 'es' } }
        );
        const data = await res.json();
        setSuggestions(data);
      } catch {
        setError('Error buscando la dirección');
      } finally {
        setSearching(false);
      }
    }, 500);
  }, [onChange]);

  // ── 4. Seleccionar sugerencia ──────────────────────────────────────────────
  function selectSuggestion(s) {
    const selectedLat = parseFloat(s.lat);
    const selectedLng = parseFloat(s.lon);
    setQuery(s.display_name);
    setSuggestions([]);
    onChange(s.display_name, selectedLat, selectedLng);
  }

  // ── 5. Borrar ubicación ────────────────────────────────────────────────────
  function clearLocation() {
    setQuery('');
    setSuggestions([]);
    onChange('', null, null);
    if (markerRef.current && mapInstanceRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }

  return (
    <div className="space-y-2">
      {/* Input de dirección */}
      <div className="relative">
        <div className="relative flex items-center">
          <span className="absolute left-3 text-base pointer-events-none select-none">📍</span>
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Escribe una dirección o haz clic en el mapa…"
            maxLength={300}
            autoComplete="off"
            className="w-full bg-surface-bg border border-surface-border rounded-xl pl-9 pr-8 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
          {searching && (
            <div className="absolute right-9 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            </div>
          )}
          {query && (
            <button
              type="button"
              onClick={clearLocation}
              className="absolute right-3 text-slate-500 hover:text-slate-300 transition-colors text-xs"
              title="Limpiar"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sugerencias */}
        {suggestions.length > 0 && (
          <ul className="absolute z-[9999] left-0 right-0 top-full mt-1 bg-surface-card border border-surface-border rounded-xl overflow-hidden shadow-xl max-h-52 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s.place_id}>
                <button
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  className="w-full text-left px-4 py-2.5 text-sm text-surface-text hover:bg-surface-bg transition-colors border-b border-surface-border/50 last:border-0 flex items-start gap-2"
                >
                  <span className="text-xs mt-0.5 flex-shrink-0">📍</span>
                  <span className="line-clamp-2">{s.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 font-mono">{error}</p>
      )}

      {/* Mapa */}
      <div
        className="relative rounded-xl overflow-hidden border border-surface-border"
        style={{ height: 220 }}
      >
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-bg z-10">
            <div className="flex flex-col items-center gap-2 text-surface-muted">
              <div className="w-6 h-6 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
              <span className="text-xs font-mono">Cargando mapa…</span>
            </div>
          </div>
        )}
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {/* Hint overlay */}
        {mapReady && !lat && !lng && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none z-[400]">
            <span className="text-xs bg-black/70 text-slate-300 rounded-lg px-2.5 py-1 font-mono backdrop-blur-sm whitespace-nowrap">
              Haz clic en el mapa para fijar la ubicación
            </span>
          </div>
        )}
      </div>

      {/* Coordenadas (confirmación visual) */}
      {lat != null && lng != null && (
        <p className="text-xs text-slate-600 font-mono text-right">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
      )}
    </div>
  );
}
