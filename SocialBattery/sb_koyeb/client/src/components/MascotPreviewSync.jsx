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

// Se incrementa cada vez que cambia la LÓGICA de posicionamiento/composición
// en mascotRenderer.js (p. ej. al corregir el offset de la riñonera). El
// "signature" de abajo solo cambia cuando cambia el equipado, así que sin
// esto una corrección de fórmula nunca se resubiría para quien ya tuviera
// ese ítem puesto desde antes: el signature seguiría siendo idéntico. Al
// incluir esta versión en el signature, cualquier bump fuerza una
// regeneración + resubida en el siguiente login de TODOS los usuarios, sin
// que tengan que reequipar nada.
const RENDER_LOGIC_VERSION = 2; // v2: fix offset riñonera (ajuste 4, +2% derecha)

export default function MascotPreviewSync() {
  const { profile } = useAuth();
  const {
    skinHydrated,
    activeActivity, activeAccessories, activeOutfit, activeFeet, activeHead,
    getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
  } = useMascot();

  const timerRef = useRef(null);
  const lastSignatureRef = useRef(null);

  // getMascotLayers/getFeetZones/getHeadZones/getOutfitZones/
  // getAccessoryZones se recrean en CADA render de MascotProvider (no están
  // memoizadas con useCallback). Si entraran en el array de dependencias
  // del efecto de abajo, cualquier re-render ajeno del provider (navegar de
  // página, un toast, el heartbeat de presencia, cualquier contexto por
  // encima de MascotProvider actualizándose…) reiniciaría el debounce una y
  // otra vez — y si esos re-renders eran más frecuentes que
  // SYNC_DEBOUNCE_MS, la subida de la imagen corregida podía no llegar a
  // completarse NUNCA. Guardamos las funciones en un ref (actualizado en
  // cada render, sin ser dependencia) para usar siempre la versión más
  // reciente al disparar, sin que su cambio de identidad reinicie el timer.
  const mascotApiRef = useRef(null);
  mascotApiRef.current = { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones };

  useEffect(() => {
    if (!profile?.id || !skinHydrated) return;

    // Firma del estado equipado actual (no incluye lo desbloqueado, que no
    // afecta al aspecto visual): si no cambió desde la última subida, no
    // hace falta volver a generar ni subir nada.
    const signature = JSON.stringify({
      v: RENDER_LOGIC_VERSION,
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
        const overlayBlob = await renderMascotOverlayBlob(mascotApiRef.current);

        const formData = new FormData();
        // Sin capas equipadas (mascota base): se envía sin adjuntar
        // archivo, el servidor lo interpreta como "limpiar la preview".
        if (overlayBlob) formData.append('mascot', overlayBlob, 'mascot.png');

        await api.postForm('/users/mascot-preview', formData);
      } catch (e) {
        // Fallo silencioso: no es crítico (la mascota base sigue viéndose
        // bien en la tarjeta de amigo), se reintentará en el próximo cambio.
        console.error('[MascotPreviewSync] No se pudo sincronizar la preview:', e);
      }
    }, SYNC_DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // getMascotLayers/getFeetZones/... deliberadamente fuera del array (ver
    // comentario de mascotApiRef arriba): dependen solo del equipado real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.id, skinHydrated,
    activeActivity, activeOutfit, activeFeet, activeHead, activeAccessories,
  ]);

  return null;
}
