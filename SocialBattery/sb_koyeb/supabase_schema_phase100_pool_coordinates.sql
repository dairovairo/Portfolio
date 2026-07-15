-- Phase 100: Pool (quedada) Location Coordinates
--
-- Hasta ahora las quedadas solo guardaban la ubicación como texto libre
-- (location_hint). El modo Sniffer tenía que geocodificar ese texto con
-- Nominatim cada vez para pintar el mapa, pero el punto que se clicaba en
-- LocationPicker ya se había pasado antes por un reverse-geocode para
-- convertirlo en texto — ese texto, al volver a geocodificarse hacia
-- adelante (forward geocode) en el Sniffer, no siempre devuelve el mismo
-- punto exacto que se clicó (Nominatim suele devolver el centroide del
-- edificio/portal asociado a esa dirección), lo que producía un desfase
-- sistemático de ~15-20 metros siempre en la misma dirección.
--
-- Igual que se hizo en la fase 27 para community_events, guardamos ahora
-- las coordenadas reales del clic en el mapa junto con el texto, y el
-- Sniffer las usa directamente sin volver a geocodificar.

ALTER TABLE public.hangout_pools
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

COMMENT ON COLUMN public.hangout_pools.lat IS
  'Latitude of the pool location (set via LocationPicker click on map)';
COMMENT ON COLUMN public.hangout_pools.lng IS
  'Longitude of the pool location (set via LocationPicker click on map)';
