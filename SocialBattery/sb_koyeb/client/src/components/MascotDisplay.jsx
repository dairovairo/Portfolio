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
 *   feetOffsetX      desplaza la capa de pies horizontalmente (ej. '2%' la
 *                     mueve un poco a la derecha), para prendas cuyo PNG
 *                     queda descentrado respecto al resto del calzado (ver
 *                     `offsetX` en MASCOT_FEET).
 *   feetScale        override de escala del calzado (0–1, ej. 0.73), para
 *                     prendas cuyo PNG viene dibujado más grande que el
 *                     resto del calzado de su mismo grupo (ver `scale` en
 *                     MASCOT_FEET). Si no se pasa, se usa la escala de la
 *                     prenda activa del contexto. Si la prenda no define
 *                     escala, se muestra a tamaño completo del lienzo
 *                     (comportamiento por defecto).
 *   feetItemId       id del ítem de MASCOT_FEET que se está mostrando (ej.
 *                     'feet_sneaker_1'), usado para aplicar su receta de
 *                     personalización de color si el usuario le cambió los
 *                     colores (ver feetCustomizations / lib/colorZones.js).
 *                     Si no se pasa, se usa el id del calzado activo del
 *                     contexto (comportamiento por defecto al no
 *                     sobreescribir feetSrc).
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
 *   headOffsetX      desplaza la capa de cabeza horizontalmente (ej. '-1.5%'
 *                     la mueve un poco a la izquierda), encima del centrado
 *                     automático (ver `offsetX` en MASCOT_HEAD).
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
 *   activityScale    override escala de la capa de actividad (0–1). Si la
 *                     actividad define `scale` en MASCOT_ACTIVITIES, se usa
 *                     ese valor; este prop lo sobreescribe. Sin valor: tamaño
 *                     completo del lienzo (comportamiento por defecto).
 *   activityOffsetX  override desplazamiento horizontal de la capa de actividad
 *                     en puntos porcentuales (positivo = derecha). Se suma al
 *                     centrado automático derivado de activityScale.
 *   outfitOffsetY    desplaza la capa de outfit hacia abajo (ej. '20%'), para
 *                     que no tape la cara de la mascota. Por defecto es '20%'
 *                     (la misma posición usada en la vista previa de la tienda),
 *                     para que la mascota del menú principal luzca igual.
 *                     Pasar null/"" para desactivar el desplazamiento.
 *   outfitSubcategory override de subcategoría ('camiseta' | 'camisa'), usado
 *                     por la tienda para previsualizar un ítem que no es el
 *                     equipado. Si no se pasa, se usa la del outfit activo.
 *   outfitItemOffsetY ajuste vertical propio de la prenda concreta (ej. '-4%'
 *                     la sube un poco), para prendas cuyo PNG queda algo
 *                     descolocado respecto al resto de la misma subcategoría
 *                     (ver `offsetY` en MASCOT_OUTFITS). Se suma al cálculo
 *                     normal de outfitOffsetY. Si no se pasa, se usa el de la
 *                     prenda activa del contexto.
 *   outfitItemScale   ajuste de tamaño propio de la prenda concreta (ej. 0.985
 *                     la reduce un 1.5%), multiplicado sobre el scale general
 *                     de la subcategoría (ver `scale` en MASCOT_OUTFITS, p.ej.
 *                     todas las camisetas salvo "Camiseta del abuelo"). Si no
 *                     se pasa, se usa el de la prenda activa del contexto.
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
import { useColorizedSrc } from '../hooks/useColorizedSrc';

function ColorizedImage({ src, zones, ...props }) {
  const displaySrc = useColorizedSrc(src, zones);
  return <img src={displaySrc} {...props} />;
}

export default function MascotDisplay({
  tier = 'mid',
  size = 128,
  className = '',
  style = {},
  glowColor,
  animate = false,
  baseSrc,
  outfitSrc,
  outfitItemId,
  outfitSubcategory,
  outfitItemOffsetY,
  outfitItemScale,
  feetSrc,
  feetItemId,
  feetOffsetY,
  feetOffsetX,
  feetScale,
  headSrc,
  headItemId,
  headScale,
  headOffsetY,
  headOffsetX,
  headBox,
  accessories,
  activityLayers,
  activityScale,
  activityOffsetX,
  outfitOffsetY = '20%',
}) {
  const { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones } = useMascot();

  const resolved  = getMascotLayers(tier);
  const base      = baseSrc          !== undefined ? baseSrc          : resolved.base;
  const outfit    = outfitSrc        !== undefined ? outfitSrc        : resolved.outfit;
  const outfitId  = outfitItemId     !== undefined ? outfitItemId     : resolved.outfitId ?? null;
  const outfitZones = outfitId ? getOutfitZones(outfitId) : null;
  const outfitDisplaySrc = useColorizedSrc(outfit, outfitZones);
  const feet      = feetSrc          !== undefined ? feetSrc          : resolved.feet;
  const feetId    = feetItemId       !== undefined ? feetItemId       : resolved.feetId;
  const feetZones = feetId ? getFeetZones(feetId) : null;
  const feetDisplaySrc = useColorizedSrc(feet, feetZones);
  const feetOffset = feetOffsetY     !== undefined ? feetOffsetY      : resolved.feetOffsetY;
  const feetOffsetXResolved = feetOffsetX !== undefined ? feetOffsetX : resolved.feetOffsetX;
  const feetScl   = feetScale        !== undefined ? feetScale        : resolved.feetScale;
  const head      = headSrc          !== undefined ? headSrc          : resolved.head;
  // headItemId permite aplicar zonas de color (personalización extrema) al
  // gorro, igual que feetItemId lo hace con el calzado. Si no se pasa, se
  // intenta resolver desde getMascotLayers (donde ya se incluye el id del
  // gorro activo, sea de catálogo o personalizado).
  const headId    = headItemId       !== undefined ? headItemId       : resolved.headId ?? null;
  const headZones = headId ? getHeadZones(headId) : null;
  const headDisplaySrc = useColorizedSrc(head, headZones);
  const headScl   = headScale        !== undefined ? headScale        : resolved.headScale;
  const headOffset = headOffsetY     !== undefined ? headOffsetY      : resolved.headOffsetY;
  const headOffsetXResolved = headOffsetX !== undefined ? headOffsetX : resolved.headOffsetX;
  const headBx    = headBox          !== undefined ? headBox          : resolved.headBox;
  const accs      = accessories      !== undefined ? accessories      : resolved.accessories;
  const layers    = activityLayers   !== undefined ? activityLayers   : resolved.layers;
  const actScl    = activityScale    !== undefined ? activityScale    : resolved.activityScale;
  const actOffX   = activityOffsetX  !== undefined ? activityOffsetX  : resolved.activityOffsetX;
  const subcat    = outfitSubcategory !== undefined ? outfitSubcategory : resolved.outfitSubcategory;
  const outfitItemOffset = outfitItemOffsetY !== undefined ? outfitItemOffsetY : resolved.outfitItemOffsetY;
  const outfitItemScl    = outfitItemScale   !== undefined ? outfitItemScale   : resolved.outfitItemScale;

  // Ajuste de tamaño/posición de la capa outfit según subcategoría
  // (camiseta vs camisa) — ver OUTFIT_VISUAL_ADJUST en MascotContext.jsx.
  // Se multiplica por el `scale` propio de la prenda si lo tiene (ej. todas
  // las camisetas salvo "Camiseta del abuelo", ver outfitItemScale).
  const outfitAdjust   = OUTFIT_VISUAL_ADJUST[subcat] ?? OUTFIT_VISUAL_ADJUST.camiseta;
  const outfitSizePct  = outfitAdjust.scale * (outfitItemScl ?? 1) * 100;
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

      {/* Capa 2: pies / calzado (overlay a tamaño completo por defecto, con
          offset vertical/horizontal opcional por prenda — ver feetOffsetY/
          feetOffsetX / MASCOT_FEET.offsetY/offsetX). Si la prenda define
          `scale` (ver MASCOT_FEET.scale) se reduce y recentra con el mismo
          cálculo cuadrado que usa la capa de cabeza, para las prendas cuyo
          PNG viene dibujado más grande que el resto del calzado. */}
      {feet && (
        <img
          src={feetDisplaySrc}
          alt=""
          draggable={false}
          className={imgClass}
          style={
            feetScl
              ? {
                  top: `calc(${(100 - feetScl * 100) / 2}% + ${feetOffset || '0%'})`,
                  left: `calc(${(100 - feetScl * 100) / 2}% + ${feetOffsetXResolved || '0%'})`,
                  width: `${feetScl * 100}%`,
                  height: `${feetScl * 100}%`,
                }
              : {
                  ...(feetOffset ? { top: `calc(0% + ${feetOffset})` } : {}),
                  ...(feetOffsetXResolved ? { left: `calc(0% + ${feetOffsetXResolved})` } : {}),
                }
          }
        />
      )}

      {/* Capa 3: outfit / torso (camiseta o camisa) — tamaño/posición según
          subcategoría, ver OUTFIT_VISUAL_ADJUST en MascotContext.jsx. Si la
          prenda define su propio offsetY (ver MASCOT_OUTFITS), se suma como
          empujoncito extra encima del outfitOffsetY general. */}
      {outfit && (
        <img
          src={outfitDisplaySrc}
          alt=""
          draggable={false}
          className={imgClass}
          style={{
            top: outfitOffsetY
              ? `calc(${outfitTopPct}% + ${outfitOffsetY}${outfitItemOffset ? ` + ${outfitItemOffset}` : ''})`
              : outfitItemOffset
                ? `calc(${outfitTopPct}% + ${outfitItemOffset})`
                : `${outfitTopPct}%`,
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
          src={headDisplaySrc}
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
                  left: `calc(${(100 - headScl * 100) / 2}% + ${headOffsetXResolved || '0%'})`,
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
        const accZones = acc.id ? getAccessoryZones(acc.id) : null;

        // Gafas y resto de accesorios "planos" → overlay a tamaño completo
        // del lienzo, salvo que la prenda defina `scale` (ver acc_glasses_gold
        // en MASCOT_ACCESSORIES), en cuyo caso se reduce y recentra con el
        // mismo cálculo cuadrado que usa la capa de cabeza.
        if (!acc.isChain && !acc.isGrillz && !acc.isTie && !acc.isBowTie && !acc.isRinon) {
          if (acc.scale) {
            const pct = acc.scale * 100;
            const pos = (100 - pct) / 2;
            return (
              <ColorizedImage
                key={acc.id}
                src={acc.src}
                zones={accZones}
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
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
              alt=""
              draggable={false}
              className={imgClass}
            />
          );
        }

        // Grillz — al 25.5% del tamaño, centrados.
        if (acc.isGrillz) {
          return (
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
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
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
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
        // Bajada un 2% más (50% → 52%), mismo incremento que la pajarita para
        // que ambas bajen por igual. Bajada otro 2% más (52% → 54%), mismo
        // incremento de nuevo en ambas.
        if (acc.isTie) {
          return (
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                left: '32%',
                width: '36%',
                top: '54%',
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
        // seguir centrada. Bajada un poquito más dos veces (46%→46.7%→47.4%),
        // ajustes muy sutiles. Bajada un 2% más (47.4% → 49.4%), mismo
        // incremento que la corbata para que ambas bajen por igual. Bajada
        // otro 2% más (49.4% → 51.4%), mismo incremento de nuevo en ambas.
        if (acc.isBowTie) {
          return (
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                left: '25.25%',
                width: '49.5%',
                top: '51.4%',
                height: '19.8%',
                objectFit: 'contain',
                objectPosition: 'center',
              }}
            />
          );
        }

        // Riñonera — posicionada en la zona de la cadera/cintura.
        // PNG 900×900 normalizado: la riñonera ocupa aprox. el 93% del ancho
        // del lienzo y está centrada. Se escala y posiciona para quedar en
        // la cadera de la mascota.
        // Ajuste inicial: left=5%, width=90%, top=62%, height=35%.
        if (acc.isRinon) {
          return (
            <ColorizedImage
              key={acc.id}
              src={acc.src}
              zones={accZones}
              alt=""
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                left: '5%',
                width: '90%',
                top: '62%',
                height: '35%',
                objectFit: 'contain',
                objectPosition: 'center',
              }}
            />
          );
        }

        return null;
      })}

      {/* Capa 6: actividad (la más delantera).
          Si la actividad define `scale`/`offsetX` se reduce y recentra con el
          mismo cálculo cuadrado que usa la capa de cabeza: el centrado se
          obtiene como (100 - pct) / 2 y el offsetX se suma en puntos
          porcentuales (positivo = derecha). */}
      {layers.map((src, i) => {
        const isLast = i === layers.length - 1;
        if (actScl) {
          const pct = actScl * 100;
          const pos = (100 - pct) / 2;
          const leftPct = pos + (actOffX ?? 0);
          return (
            <img
              key={src}
              src={src}
              alt=""
              draggable={false}
              className={imgClass}
              style={{
                top:    `${pos}%`,
                left:   `${leftPct}%`,
                width:  `${pct}%`,
                height: `${pct}%`,
                ...(isLast ? animStyle : {}),
              }}
            />
          );
        }
        return (
          <img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className={imgClass}
            style={isLast ? animStyle : {}}
          />
        );
      })}
    </div>
  );
}
