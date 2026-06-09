/**
 * MascotDisplay — renderiza la mascota en sistema de 3 capas:
 *   1. Capa base       (mascota según tier de batería)
 *   2. Capa accesorio  (intermedia: gafas, cadena, gorra…)
 *   3. Capa actividad  (delantera: ajedrez, balón, gaming…)
 *
 * Props:
 *   tier             'high' | 'mid' | 'low'
 *   size             número en px (default 128)
 *   className        clases extra para el contenedor
 *   style            estilos extra para el contenedor
 *   glowColor        color hex para el drop-shadow en la base
 *   animate          boolean — aplica mascotFadeIn al montar
 *   // Overrides para previews en tienda:
 *   baseSrc          override imagen base
 *   accessorySrc     override accesorio (null = sin accesorio)
 *   activityLayers   override capas actividad []
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
  accessorySrc,
  activityLayers,
}) {
  const { getMascotLayers } = useMascot();

  const resolved = getMascotLayers(tier);
  const base      = baseSrc        !== undefined ? baseSrc        : resolved.base;
  const accessory = accessorySrc   !== undefined ? accessorySrc   : resolved.accessory;
  const layers    = activityLayers !== undefined ? activityLayers : resolved.layers;

  const sizeStyle  = typeof size === 'number' ? { width: size, height: size } : {};
  const shadowStyle = glowColor ? { filter: `drop-shadow(0 0 18px ${glowColor}55)` } : {};
  const animStyle  = animate    ? { animation: 'mascotFadeIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' } : {};

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

      {/* Capa 2: accesorio (intermedia) */}
      {accessory && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className={imgClass}
        />
      )}

      {/* Capa 3: actividad (delantera) */}
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
