/**
 * MascotDisplay — renderiza la mascota en sistema de 6 capas:
 *   1. Capa base       (mascota según tier de batería)
 *   2. Capa pies       (calzado — outfit, sub-categoría Pies)     ← NUEVA
 *   3. Capa outfit     (torso: camiseta/camisa)
 *   4. Capa cabeza     (gorra… — outfit, sub-categoría Cabeza)    ← NUEVA
 *   5. Capa accesorio  (gafas, cadena, grillz… — varios a la vez)
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
 *   feetOffsetY      desplaza la capa de pies hacia abajo (ej. '6%'), para
 *                     prendas cuyo PNG queda un poco alto respecto al resto
 *                     del calzado (ver `offsetY` en MASCOT_FEET). Si no se
 *                     pasa, se usa el offset del calzado activo del contexto.
 *   headSrc          override cabeza (null = sin gorro)
 *   headScale        override escala de la prenda de cabeza (0–1, ej. 0.33),
 *                     para prendas cuyo PNG viene mucho más grande que la
 *                     cabeza real (ver `scale` en MASCOT_HEAD). Si no se
 *                     pasa, se usa la escala de la prenda activa del contexto.
 *                     Si la prenda no define escala, se muestra a tamaño
 *                     completo del lienzo (comportamiento por defecto).
 *   headOffsetY      desplaza la capa de cabeza (ej. '-5%' la sube un poco),
 *                     para que la prenda asiente justo encima de la cabeza
 *                     de la mascota (ver `offsetY` en MASCOT_HEAD).
 *   headBox          override de caja explícita {left,top,width,height} en %
 *                     (ver `box` en MASCOT_HEAD), para prendas cuyo PNG no es
 *                     cuadrado (ej. el halo, un anillo elíptico ancho). Si la
 *                     prenda define `box`, tiene prioridad sobre headScale/
 *                     headOffsetY y se posiciona con esos cuatro valores
 *                     directamente, sin cálculo de centrado.
 *   accessories      override lista de accesorios activos (array de objetos
 *                     del catálogo MASCOT_ACCESSORIES). Los accesorios pueden
 *                     combinarse y mostrarse todos a la vez. Pasar [] para no
 *                     mostrar ninguno, o no pasar la prop para usar los
 *                     accesorios activos del contexto.
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
 * Las capas de pies y cabeza, igual que cada accesorio, son overlays
 * posicionados según su tipo (el PNG ya trae la posición correcta integrada
 * para los que son a tamaño completo del lienzo).
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
  feetOffsetY,
  headSrc,
  headScale,
  headOffsetY,
  headBox,
  accessories,
  activityLayers,
  outfitOffsetY = '20%',
}) {
  const { getMascotLayers } = useMascot();

  const resolved  = getMascotLayers(tier);
  const base      = baseSrc          !== undefined ? baseSrc          : resolved.base;
  const outfit    = outfitSrc        !== undefined ? outfitSrc        : resolved.outfit;
  const feet      = feetSrc          !== undefined ? feetSrc          : resolved.feet;
  const feetOffset = feetOffsetY     !== undefined ? feetOffsetY      : resolved.feetOffsetY;
  const head      = headSrc          !== undefined ? headSrc          : resolved.head;
  const headScl   = headScale        !== undefined ? headScale        : resolved.headScale;
  const headOffset = headOffsetY     !== undefined ? headOffsetY      : resolved.headOffsetY;
  const headBx    = headBox          !== undefined ? headBox          : resolved.headBox;
  const accs      = accessories      !== undefined ? accessories      : resolved.accessories;
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

      {/* Capa 2: pies / calzado (overlay a tamaño completo, con offset
          opcional por prenda — ver feetOffsetY / MASCOT_FEET.offsetY) */}
      {feet && (
        <img
          src={feet}
          alt=""
          draggable={false}
          className={imgClass}
          style={feetOffset ? { top: `calc(0% + ${feetOffset})` } : {}}
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

      {/* Capa 4: cabeza (gorra…, halo…). Por defecto es overlay a tamaño
          completo. Si la prenda define `box` (caja explícita left/top/width/
          height, ver MASCOT_HEAD en MascotContext.jsx) se usa esa caja
          directamente — necesario para PNGs no cuadrados como el halo.
          Si en cambio define `scale`/`offsetY` (como la gorra) se reduce y
          recentra con ese cálculo cuadrado. */}
      {head && (
        <img
          src={head}
          alt=""
          draggable={false}
          className={imgClass}
          style={
            headBx
              ? {
                  top: headBx.top,
                  left: headBx.left,
                  width: headBx.width,
                  height: headBx.height,
                }
              : headScl
              ? {
                  top: `calc(${(100 - headScl * 100) / 2}% + ${headOffset || '0%'})`,
                  left: `${(100 - headScl * 100) / 2}%`,
                  width: `${headScl * 100}%`,
                  height: `${headScl * 100}%`,
                }
              : {}
          }
        />
      )}

      {/* Capa 5: accesorio(s) — gafas, cadena, grillz, corbata, pajarita…
          Pueden combinarse y se muestran todos a la vez, cada uno con su
          propio posicionamiento según tipo. */}
      {accs.map(acc => {
        if (!acc.src) return null;

        // Gafas y resto de accesorios "planos" → overlay a tamaño completo
        // del lienzo, salvo que la prenda defina `scale` (ver acc_glasses_gold
        // en MASCOT_ACCESSORIES), en cuyo caso se reduce y recentra con el
        // mismo cálculo cuadrado que usa la capa de cabeza.
        if (!acc.isChain && !acc.isGrillz && !acc.isTie && !acc.isBowTie) {
          if (acc.scale) {
            const pct = acc.scale * 100;
            const pos = (100 - pct) / 2;
            return (
              <img
                key={acc.id}
                src={acc.src}
                alt=""
                draggable={false}
                className={imgClass}
                style={{
                  top: `${pos}%`,
                  left: `${pos}%`,
                  width: `${pct}%`,
                  height: `${pct}%`,
                }}
              />
            );
          }
          return (
            <img
              key={acc.id}
              src={acc.src}
              alt=""
              draggable={false}
              className={imgClass}
            />
          );
        }

        // Grillz — al 25.5% del tamaño, centrados.
        if (acc.isGrillz) {
          return (
            <img
              key={acc.id}
              src={acc.src}
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
          );
        }

        // Cadena — posicionada en cuello/pecho.
        if (acc.isChain) {
          return (
            <img
              key={acc.id}
              src={acc.src}
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
          );
        }

        // Corbata — 20% más grande que el tamaño original (30% → 36% de
        // ancho, 60% → 72% de alto). Bajada bastante respecto a versiones
        // anteriores (28% → 34% → 46% → 48% → 50% de top) para que el nudo
        // quede justo debajo de la "boca" (la línea horizontal) de la mascota.
        if (acc.isTie) {
          return (
            <img
              key={acc.id}
              src={acc.src}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                left: '32%',
                width: '36%',
                top: '50%',
                height: '72%',
                objectFit: 'contain',
                objectPosition: 'top center',
              }}
            />
          );
        }

        // Pajarita — 10% más grande que el tamaño original (50% → 55% de
        // ancho, 20% → 22% de alto). Bajada un poco más respecto a versiones
        // anteriores (34% → 40% → 42% → 44% → 46% de top) — mismo incremento
        // que la corbata, para que ambas bajen por igual. Reducida un 10%
        // adicional (55%→49.5% ancho, 22%→19.8% alto), left recalculado para
        // seguir centrada.
        if (acc.isBowTie) {
          return (
            <img
              key={acc.id}
              src={acc.src}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                left: '25.25%',
                width: '49.5%',
                top: '46%',
                height: '19.8%',
                objectFit: 'contain',
                objectPosition: 'center',
              }}
            />
          );
        }

        return null;
      })}

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
