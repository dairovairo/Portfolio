/**
 * MascotDisplay — renderiza la mascota en sistema de 4 capas:
 *   1. Capa base       (mascota según tier de batería)
 *   2. Capa outfit     (torso: camiseta/camisa)          ← NUEVA
 *   3. Capa accesorio  (gafas, cadena, gorra…)
 *   4. Capa actividad  (ajedrez, balón, gaming…)
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
 *   outfitSrc        override outfit (null = sin outfit)
 *   accessorySrc     override accesorio (null = sin accesorio)
 *   activityLayers   override capas actividad []
 *   outfitOffsetY    desplaza la capa de outfit hacia abajo (ej. '20%'), para
 *                     que no tape la cara de la mascota (usado en la tienda)
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
  outfitSrc,
  accessorySrc,
  accessoryIsChain,
  activityLayers,
  outfitOffsetY,
}) {
  const { getMascotLayers } = useMascot();

  const resolved  = getMascotLayers(tier);
  const base      = baseSrc          !== undefined ? baseSrc          : resolved.base;
  const outfit    = outfitSrc        !== undefined ? outfitSrc        : resolved.outfit;
  const accessory = accessorySrc     !== undefined ? accessorySrc     : resolved.accessory;
  const isChain   = accessoryIsChain !== undefined ? accessoryIsChain : resolved.accessoryIsChain;
  const layers    = activityLayers   !== undefined ? activityLayers   : resolved.layers;

  const sizeStyle   = typeof size === 'number' ? { width: size, height: size } : {};
  const shadowStyle = glowColor ? { filter: `drop-shadow(0 0 18px ${glowColor}55)` } : {};
  const animStyle   = animate   ? { animation: 'mascotFadeIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' } : {};

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

      {/* Capa 2: outfit / torso (camiseta o camisa) */}
      {outfit && (
        <img
          src={outfit}
          alt=""
          draggable={false}
          className={imgClass}
          style={outfitOffsetY ? { transform: `translateY(${outfitOffsetY})` } : {}}
        />
      )}

      {/* Capa 3: accesorio (intermedia sobre el outfit) */}
      {accessory && !isChain && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className={imgClass}
        />
      )}
      {/* Capa 3b: cadena — posicionada en cuello/pecho */}
      {accessory && isChain && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{
            left: '-10%',
            width: '120%',
            top: '10%',
            height: '85%',
            objectFit: 'contain',
            objectPosition: 'top center',
          }}
        />
      )}

      {/* Capa 4: actividad (la más delantera) */}
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
