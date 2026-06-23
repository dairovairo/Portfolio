import { useMascot, OUTFIT_VISUAL_ADJUST } from '../context/MascotContext';
import { useColorizedSrc } from '../hooks/useColorizedSrc';

function AccessoryLayer({ accessory, zones }) {
  const displaySrc = useColorizedSrc(accessory.src, zones);
  if (!displaySrc) return null;

  const imgClass = 'absolute inset-0 w-full h-full object-contain select-none pointer-events-none';

  if (!accessory.isChain && !accessory.isGrillz && !accessory.isTie && !accessory.isBowTie) {
    if (accessory.scale) {
      const pct = accessory.scale * 100;
      const pos = (100 - pct) / 2;
      return (
        <img
          src={displaySrc}
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
    return <img src={displaySrc} alt="" draggable={false} className={imgClass} />;
  }

  if (accessory.isGrillz) {
    return (
      <img
        src={displaySrc}
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

  if (accessory.isChain) {
    return (
      <img
        src={displaySrc}
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

  if (accessory.isTie) {
    return (
      <img
        src={displaySrc}
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

  if (accessory.isBowTie) {
    return (
      <img
        src={displaySrc}
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

  return null;
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
  outfitSubcategory,
  outfitItemOffsetY,
  outfitItemScale,
  outfitItemId,
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

  const resolved = getMascotLayers(tier);
  const base = baseSrc !== undefined ? baseSrc : resolved.base;
  const outfit = outfitSrc !== undefined ? outfitSrc : resolved.outfit;
  const outfitId = outfitItemId !== undefined ? outfitItemId : resolved.outfitId ?? null;
  const outfitDisplaySrc = useColorizedSrc(outfit, outfitId ? getOutfitZones(outfitId) : null);

  const feet = feetSrc !== undefined ? feetSrc : resolved.feet;
  const feetId = feetItemId !== undefined ? feetItemId : resolved.feetId;
  const feetDisplaySrc = useColorizedSrc(feet, feetId ? getFeetZones(feetId) : null);
  const feetOffset = feetOffsetY !== undefined ? feetOffsetY : resolved.feetOffsetY;
  const feetOffsetXResolved = feetOffsetX !== undefined ? feetOffsetX : resolved.feetOffsetX;
  const feetScl = feetScale !== undefined ? feetScale : resolved.feetScale;

  const head = headSrc !== undefined ? headSrc : resolved.head;
  const headId = headItemId !== undefined ? headItemId : resolved.headId ?? null;
  const headDisplaySrc = useColorizedSrc(head, headId ? getHeadZones(headId) : null);
  const headScl = headScale !== undefined ? headScale : resolved.headScale;
  const headOffset = headOffsetY !== undefined ? headOffsetY : resolved.headOffsetY;
  const headOffsetXResolved = headOffsetX !== undefined ? headOffsetX : resolved.headOffsetX;
  const headBx = headBox !== undefined ? headBox : resolved.headBox;

  const accs = accessories !== undefined ? accessories : resolved.accessories;
  const layers = activityLayers !== undefined ? activityLayers : resolved.layers;
  const actScl = activityScale !== undefined ? activityScale : resolved.activityScale;
  const actOffX = activityOffsetX !== undefined ? activityOffsetX : resolved.activityOffsetX;
  const subcat = outfitSubcategory !== undefined ? outfitSubcategory : resolved.outfitSubcategory;
  const outfitItemOffset = outfitItemOffsetY !== undefined ? outfitItemOffsetY : resolved.outfitItemOffsetY;
  const outfitItemScl = outfitItemScale !== undefined ? outfitItemScale : resolved.outfitItemScale;

  const outfitAdjust = OUTFIT_VISUAL_ADJUST[subcat] ?? OUTFIT_VISUAL_ADJUST.camiseta;
  const outfitSizePct = outfitAdjust.scale * (outfitItemScl ?? 1) * 100;
  const outfitCenterPct = (100 - outfitSizePct) / 2;
  const outfitLeftPct = outfitCenterPct + (outfitAdjust.offsetX ?? 0);
  const outfitTopPct = outfitCenterPct;

  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : {};
  const shadowStyle = glowColor ? { filter: `drop-shadow(0 0 18px ${glowColor}55)` } : {};
  const animStyle = animate ? { animation: 'mascotFadeIn 0.35s cubic-bezier(0.34,1.56,0.64,1)' } : {};
  const imgClass = 'absolute inset-0 w-full h-full object-contain select-none pointer-events-none';

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{ ...sizeStyle, ...style }}
    >
      <img
        src={base}
        alt="Mascota"
        draggable={false}
        className={imgClass}
        style={{ ...shadowStyle, ...animStyle }}
      />

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

      {accs.map(acc => (
        <AccessoryLayer
          key={acc.id}
          accessory={acc}
          zones={acc.id ? getAccessoryZones(acc.id) : null}
        />
      ))}

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
                top: `${pos}%`,
                left: `${leftPct}%`,
                width: `${pct}%`,
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
