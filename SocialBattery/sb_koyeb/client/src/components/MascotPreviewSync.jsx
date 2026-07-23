/**
 * MascotPreviewSync — sincroniza en segundo plano un "retrato" (PNG
 * transparente) de la mascota equipada del usuario (calzado, torso, gorro,
 * accesorios y actividad, ya recoloreados) con el servidor, para que sus
 * amigos puedan verla personalizada en su tarjeta del menú principal (ver
 * FriendCard.jsx) en lugar de solo la mascota base.
 *
 * Antes, toda la personalización (equipado/desbloqueado + recetas de color)
 * vivía únicamente en localStorage del propio dispositivo, por eso nunca se
 * veía reflejada en la tarjeta de amigo de nadie más. Este componente no
 * cambia esa fuente de verdad local: simplemente "hornea" el resultado
 * visual final en una imagen y la sube (ver POST /api/users/mascot-preview),
 * cada vez que cambia algo del equipado.
 *
 * No renderiza nada — se monta una vez a nivel de app (ver App.jsx) mientras
 * hay sesión iniciada.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useMascot } from '../context/MascotContext';
import { renderMascotOverlayBlob } from '../lib/mascotRenderer';
import { api } from '../lib/api';

// Espera a que el usuario deje de tocar la mascota (tienda, editor de
// color…) antes de generar y subir la imagen, para no lanzar una subida por
// cada click mientras está probándose ítems.
const SYNC_DEBOUNCE_MS = 1200;

export default function MascotPreviewSync() {
  const { profile } = useAuth();
  const {
    skinHydrated,
    activeActivity, activeAccessories, activeOutfit, activeFeet, activeHead,
    getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
  } = useMascot();

  const timerRef = useRef(null);
  const lastSignatureRef = useRef(null);

  useEffect(() => {
    if (!profile?.id || !skinHydrated) return;

    // Firma del estado equipado actual (no incluye lo desbloqueado, que no
    // afecta al aspecto visual): si no cambió desde la última subida, no
    // hace falta volver a generar ni subir nada.
    const signature = JSON.stringify({
      activeActivity,
      activeOutfit,
      activeFeet,
      activeHead,
      activeAccessories: [...activeAccessories].sort(),
    });
    if (signature === lastSignatureRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      lastSignatureRef.current = signature;
      try {
        const overlayBlob = await renderMascotOverlayBlob({
          getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
        });

        const formData = new FormData();
        // Sin capas equipadas (mascota base): se envía sin adjuntar
        // archivo, el servidor lo interpreta como "limpiar la preview".
        if (overlayBlob) formData.append('mascot', overlayBlob, 'mascot.png');
        // Versión del formato del PNG: '2' = horneado con margen
        // transparente (ver renderMascotOverlayBlob / MASCOT_OVERLAY_PAD).
        // El servidor lo guarda en una ruta distinta (mascot-previews/v2/…)
        // para que MascotPreviewOverlay sepa cómo mostrarlo sin romper los
        // PNGs antiguos de clientes que aún no se han actualizado.
        formData.append('version', '2');

        await api.postForm('/users/mascot-preview', formData);
      } catch (e) {
        // Fallo silencioso: no es crítico (la mascota base sigue viéndose
        // bien en la tarjeta de amigo), se reintentará en el próximo cambio.
        console.error('[MascotPreviewSync] No se pudo sincronizar la preview:', e);
      }
    }, SYNC_DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [
    profile?.id, skinHydrated,
    activeActivity, activeOutfit, activeFeet, activeHead, activeAccessories,
    getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
  ]);

  return null;
}
