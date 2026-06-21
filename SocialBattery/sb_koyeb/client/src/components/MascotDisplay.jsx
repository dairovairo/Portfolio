/**
 * MascotDisplay — renderiza la mascota en sistema de 6 capas:
 *   1. Capa base       (mascota según tier de batería)
 *   2. Capa pies       (calzado — outfit, sub-categoría Pies)     ← NUEVA
 *   3. Capa outfit     (torso: camiseta/camisa)
 *   4. Capa cabeza     (gorra… — outfit, sub-categoría Cabeza)    ← NUEVA
 *   5. Capa accesorio  (gafas, cadena, grillz…)
 *   6. Capa actividad  (ajedrez, balón, gaming…)
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
 *   outfitSrc        override outfit / torso (null = sin outfit)
 *   feetSrc          override pies (null = sin calzado)
 *   headSrc          override cabeza (null = sin gorro)
 *   accessorySrc     override accesorio (null = sin accesorio)
 *   activityLayers   override capas actividad []
 *   outfitOffsetY    desplaza la capa de outfit hacia abajo (ej. '20%'), para
 *                     que no tape la cara de la mascota. Por defecto es '20%'
 *                     (la misma posición usada en la vista previa de la tienda),
 *                     para que la mascota del menú principal luzca igual.
 *                     Pasar null/"" para desactivar el desplazamiento.
 *   outfitSubcategory override de subcategoría ('camiseta' | 'camisa'), usado
 *                     por la tienda para previsualizar un ítem que no es el
 *                     equipado. Si no se pasa, se usa la del outfit activo.
 *
 * La capa de outfit (camiseta/camisa) se escala y posiciona según su
 * subcategoría (ver OUTFIT_VISUAL_ADJUST en MascotContext.jsx) y queda
 * centrada antes de aplicar outfitOffsetY. Mismo cálculo en tienda y en la
 * mascota de la pantalla principal, porque ambas usan getMascotLayers().
 * Las capas de pies y cabeza, igual que el accesorio, son overlays a tamaño
 * completo del lienzo (el PNG ya trae la posición correcta integrada).
 */
import { useMascot, OUTFIT_VISUAL_ADJUST } from '../context/MascotContext';

export default function MascotDisplay({
  tier = 'mid',
  size = 128,
  className = '',
  style = {},
  glowColor,
  animate = false,
  baseSrc,
  outfitSrc,
  outfitSubcategory,
  feetSrc,
  headSrc,
  accessorySrc,
  accessoryIsChain,
  accessoryIsGrillz,
  accessoryIsTie,
  accessoryIsBowTie,
  activityLayers,
  outfitOffsetY = '20%',
}) {
  const { getMascotLayers } = useMascot();

  const resolved  = getMascotLayers(tier);
  const base      = baseSrc          !== undefined ? baseSrc          : resolved.base;
  const outfit    = outfitSrc        !== undefined ? outfitSrc        : resolved.outfit;
  const feet      = feetSrc          !== undefined ? feetSrc          : resolved.feet;
  const head      = headSrc          !== undefined ? headSrc          : resolved.head;
  const accessory = accessorySrc     !== undefined ? accessorySrc     : resolved.accessory;
  const isChain   = accessoryIsChain   !== undefined ? accessoryIsChain   : resolved.accessoryIsChain;
  const isGrillz  = accessoryIsGrillz  !== undefined ? accessoryIsGrillz  : resolved.accessoryIsGrillz;
  const isTie     = accessoryIsTie     !== undefined ? accessoryIsTie     : resolved.accessoryIsTie;
  const isBowTie  = accessoryIsBowTie  !== undefined ? accessoryIsBowTie  : resolved.accessoryIsBowTie;
  const layers    = activityLayers   !== undefined ? activityLayers   : resolved.layers;
  const subcat    = outfitSubcategory !== undefined ? outfitSubcategory : resolved.outfitSubcategory;

  // Ajuste de tamaño/posición de la capa outfit según subcategoría
  // (camiseta vs camisa) — ver OUTFIT_VISUAL_ADJUST en MascotContext.jsx.
  const outfitAdjust   = OUTFIT_VISUAL_ADJUST[subcat] ?? OUTFIT_VISUAL_ADJUST.camiseta;
  const outfitSizePct  = outfitAdjust.scale * 100;
  // Offset que centra la capa (puede ser negativo si es más grande que la base,
  // o positivo si es más pequeña), más el empujoncito extra de la subcategoría.
  const outfitCenterPct = (100 - outfitSizePct) / 2;
  const outfitLeftPct   = outfitCenterPct + (outfitAdjust.offsetX ?? 0);
  const outfitTopPct    = outfitCenterPct;

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

      {/* Capa 2: pies / calzado (overlay a tamaño completo) */}
      {feet && (
        <img
          src={feet}
          alt=""
          draggable={false}
          className={imgClass}
        />
      )}

      {/* Capa 3: outfit / torso (camiseta o camisa) — tamaño/posición según
          subcategoría, ver OUTFIT_VISUAL_ADJUST en MascotContext.jsx */}
      {outfit && (
        <img
          src={outfit}
          alt=""
          draggable={false}
          className={imgClass}
          style={{
            top: outfitOffsetY ? `calc(${outfitTopPct}% + ${outfitOffsetY})` : `${outfitTopPct}%`,
            left: `${outfitLeftPct}%`,
            width: `${outfitSizePct}%`,
            height: `${outfitSizePct}%`,
          }}
        />
      )}

      {/* Capa 4: cabeza (gorra…, overlay a tamaño completo) */}
      {head && (
        <img
          src={head}
          alt=""
          draggable={false}
          className={imgClass}
        />
      )}

      {/* Capa 5: accesorio (gafas… — overlay a tamaño completo) */}
      {accessory && !isChain && !isGrillz && !isTie && !isBowTie && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className={imgClass}
        />
      )}
      {/* Capa 5b: grillz — al 25.5% del tamaño, centrados */}
      {accessory && isGrillz && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{
            left: '37.25%',
            top: '41%',
            width: '25.5%',
            height: '25.5%',
            objectFit: 'contain',
            objectPosition: 'center',
          }}
        />
      )}
      {/* Capa 5c: cadena — posicionada en cuello/pecho */}
      {accessory && isChain && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{
            left: '9%',
            width: '82%',
            top: '28%',
            height: '64%',
            objectFit: 'contain',
            objectPosition: 'top center',
          }}
        />
      )}
      {/* Capa 5d: corbata — centrada verticalmente en cuello/pecho */}
      {accessory && isTie && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{
            left: '35%',
            width: '30%',
            top: '28%',
            height: '60%',
            objectFit: 'contain',
            objectPosition: 'top center',
          }}
        />
      )}
      {/* Capa 5e: pajarita — centrada en el cuello */}
      {accessory && isBowTie && (
        <img
          src={accessory}
          alt=""
          draggable={false}
          className="absolute select-none pointer-events-none"
          style={{
            left: '25%',
            width: '50%',
            top: '34%',
            height: '20%',
            objectFit: 'contain',
            objectPosition: 'center',
          }}
        />
      )}

      {/* Capa 6: actividad (la más delantera) */}
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
