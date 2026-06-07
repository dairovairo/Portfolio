/**
 * MascotDisplay — renderiza la mascota en sistema de capas:
 *   1. Capa base    (mascota según tier de batería)
 *   2. Capa accesorio (futura, reservada)
 *   3. Capa actividad (prop layers o desde contexto)
 *
 * Props:
 *   tier        'high' | 'mid' | 'low'
 *   size        número en px o string tailwind-compatible (default 128)
 *   className   clases extra para el contenedor
 *   style       estilos extra para el contenedor
 *   glowColor   color hex para el drop-shadow
 *   animate     boolean — aplica mascotFadeIn al montar
 *   // Override manual (para previews en tienda):
 *   baseSrc     override de la imagen base
 *   activityLayers  array de srcs para las capas de actividad
 */
import { useMascot } from '../context/MascotContext';

export default function MascotDisplay({
  tier = 'mid',
  size = 128,
  className = '',
  style = {},
  glowColor,
  animate = false,
  baseSrc,
  activityLayers,
}) {
  const { getMascotLayers } = useMascot();

  // Si vienen overrides (preview de tienda) los usamos; si no, del contexto
  const resolved = getMascotLayers(tier);
  const base   = baseSrc        ?? resolved.base;
  const layers = activityLayers ?? resolved.layers;

  const sizeStyle = typeof size === 'number'
    ? { width: size, height: size }
    : {};

  const shadowStyle = glowColor
    ? { filter: `drop-shadow(0 0 18px ${glowColor}55)` }
    : {};

  const animStyle = animate
    ? { animation: 'mascotFadeIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' }
    : {};

  const imgClass = 'absolute inset-0 w-full h-full object-contain select-none pointer-events-none';

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{ ...sizeStyle, ...style }}
    >
      {/* Capa 1: mascota base */}
      <img
        src={base}
        alt="Mascota"
        draggable={false}
        className={imgClass}
        style={{ ...shadowStyle, ...animStyle }}
      />

      {/* Capa 2: accesorios (futura — placeholder) */}
      {/* <img src={accessorySrc} ... /> */}

      {/* Capa 3: actividad */}
      {layers.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={imgClass}
          style={i === layers.length - 1 ? animStyle : {}}
        />
      ))}
    </div>
  );
}
