/**
 * Instagram Story sharing utilities
 * Generates a canvas-based image for Instagram Stories using web_share API
 * or falls back to downloading the image.
 */

import { getBatteryColor } from './battery';
import { drawMascotOnCanvas } from './mascotRenderer';

// ── Battery Story ──────────────────────────────────────────────────────────────

export async function generateBatteryStoryBlob({ level, label, hex, username, updatedAt, mascot, mascotName }) {
  const W = 1080;
  const H = 1920;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#080f1f');
  bg.addColorStop(0.5, '#0f1e35');
  bg.addColorStop(1, '#080f1f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle dot grid
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = 60; x < W; x += 72) {
    for (let y = 60; y < H; y += 72) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const cx = W / 2;
  const arenaY = 650; // centro vertical del "escenario" de la mascota

  // Ambient glow, más rico y amplio, detrás del escenario de la mascota
  const glow = ctx.createRadialGradient(cx, arenaY, 0, cx, arenaY, 660);
  glow.addColorStop(0, `${hex}38`);
  glow.addColorStop(0.45, `${hex}18`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Destellos decorativos (estrellitas + puntos de brillo)
  drawSparkles(ctx, W, H, hex);

  // ── App branding (bigger) ──────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Battery emoji + name, bigger pill
  const pillW = 380, pillH = 80, pillX = (W - pillW) / 2, pillY = 130;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, pillX, pillY, pillW, pillH, 40);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, 40);
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('🔋 SocialBattery', W / 2, pillY + pillH / 2);

  // ── Escenario circular con la mascota y el anillo de nivel ──────────────────
  const ringOuterR = 330;
  const ringThickness = 24;
  const mascotBoxSize = 560;

  // Anillo de fondo (translúcido, marca el 100%)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = ringThickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, arenaY, ringOuterR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Anillo de progreso — representa visualmente el nivel de batería
  const pct = Math.max(0, Math.min(100, level)) / 100;
  if (pct > 0) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * pct;
    ctx.save();
    ctx.shadowColor = hex;
    ctx.shadowBlur = 32;
    ctx.strokeStyle = hex;
    ctx.lineWidth = ringThickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, arenaY, ringOuterR, startAngle, endAngle);
    ctx.stroke();
    ctx.restore();
  }

  // Fondo tipo "cristal" detrás de la mascota, dentro del anillo
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, arenaY, ringOuterR - ringThickness - 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // La mascota, con su ropa/calzado/gorro/accesorios/actividad equipados
  if (mascot) {
    try {
      await drawMascotOnCanvas(
        ctx, mascot,
        cx - mascotBoxSize / 2, arenaY - mascotBoxSize / 2, mascotBoxSize,
        { glowColor: hex }
      );
    } catch (_) {
      // Si algo falla al dibujar la mascota, seguimos sin ella.
    }
  }

  // ── Nombre de la mascota — pequeño, justo debajo de la mascota, dentro
  // del anillo (por defecto "Volty" si el usuario no le puso otro nombre). ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(mascotName || 'Volty', cx, arenaY + mascotBoxSize / 2 + 26);

  // ── Porcentaje ────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const percentageY = arenaY + ringOuterR + 100;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 130px system-ui, sans-serif';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 44;
  ctx.fillText(`${level}%`, cx, percentageY);
  ctx.shadowBlur = 0;

  // ── Status label pill ──────────────────────────────────────────────────────
  const labelY2 = percentageY + 85;
  const labelH = 76;
  ctx.font = 'bold 46px system-ui, sans-serif';
  const labelW = ctx.measureText(label).width + 72;
  const labelX = (W - labelW) / 2;
  ctx.fillStyle = `${hex}22`;
  roundRect(ctx, labelX, labelY2, labelW, labelH, 38);
  ctx.fill();
  ctx.strokeStyle = `${hex}66`;
  ctx.lineWidth = 2.5;
  roundRect(ctx, labelX, labelY2, labelW, labelH, 38);
  ctx.stroke();
  ctx.fillStyle = hex;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, labelY2 + labelH / 2);

  // ── Username ───────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = 'bold 50px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(username || 'Mi batería social', W / 2, labelY2 + labelH + 84);

  // ── Date ──────────────────────────────────────────────────────────────────
  if (updatedAt) {
    const dateStr = new Date(updatedAt).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    ctx.fillStyle = 'rgba(148,163,184,0.65)';
    ctx.font = '34px system-ui, sans-serif';
    ctx.fillText(dateStr, W / 2, labelY2 + labelH + 158);
  }

  // ── URL / CTA at bottom ───────────────────────────────────────────────────
  drawUrlBadge(ctx, W, H);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── Event Story ────────────────────────────────────────────────────────────────

export async function generateEventStoryBlob({ event, attendeeCount, likeCount, sharedBy }) {
  const W = 1080;
  const H = 1920;
  const S = 1.2; // todos los elementos de esta historia son un 20% más grandes

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── Background: blurred cover photo or dark fallback ──────────────────────
  let coverImg = null;
  if (event.cover_image_url) {
    try { coverImg = await loadImage(event.cover_image_url); } catch (_) {}
  }

  if (coverImg) {
    // Draw image scaled to cover entire canvas
    const scale = Math.max(W / coverImg.width, H / coverImg.height);
    const drawW = coverImg.width * scale;
    const drawH = coverImg.height * scale;
    const drawX = (W - drawW) / 2;
    const drawY = (H - drawH) / 2;

    // We simulate heavy blur by drawing the image multiple times at different
    // offsets and scales (true CSS blur isn't available in canvas without a
    // library, but we can stack semi-transparent scaled copies for a soft effect)
    ctx.save();
    const blurPasses = [
      { alpha: 0.18, extra: 0 },
      { alpha: 0.18, extra: 12 },
      { alpha: 0.18, extra: -12 },
      { alpha: 0.18, extra: 24 },
      { alpha: 0.18, extra: -24 },
      { alpha: 0.12, extra: 36 },
      { alpha: 0.12, extra: -36 },
      { alpha: 0.12, extra: 48 },
    ];
    for (const pass of blurPasses) {
      ctx.globalAlpha = pass.alpha;
      ctx.drawImage(coverImg, drawX + pass.extra, drawY + pass.extra * 0.5, drawW, drawH);
      ctx.drawImage(coverImg, drawX - pass.extra, drawY - pass.extra * 0.5, drawW, drawH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Dark overlay so text reads well
    const overlay = ctx.createLinearGradient(0, 0, 0, H);
    overlay.addColorStop(0,   'rgba(8,15,31,0.65)');
    overlay.addColorStop(0.4, 'rgba(8,15,31,0.55)');
    overlay.addColorStop(0.7, 'rgba(8,15,31,0.70)');
    overlay.addColorStop(1,   'rgba(8,15,31,0.85)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, W, H);
  } else {
    // No image — solid dark gradient
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#080f1f');
    bg.addColorStop(0.6, '#0f1e35');
    bg.addColorStop(1, '#080f1f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  // Márgenes laterales (un poco más ajustados para dar más protagonismo a
  // las tarjetas, ahora que todo el contenido es más grande)
  const sideMargin = 64;
  const cardW = W - sideMargin * 2;

  // ── App branding (pill at top) ──────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pillW = Math.round(380 * S), pillH = Math.round(80 * S);
  const pillX = (W - pillW) / 2, pillY = 120;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, pillX, pillY, pillW, pillH, Math.round(40 * S));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, Math.round(40 * S));
  ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `bold ${Math.round(36 * S)}px system-ui, sans-serif`;
  ctx.fillText('🔋 SocialBattery', W / 2, pillY + pillH / 2);

  // ── Cover image card (non-blurred, sharp) ─────────────────────────────────
  const cardH = Math.round(500 * S);
  const cardY = 250;
  if (coverImg) {
    ctx.save();
    roundRect(ctx, sideMargin, cardY, cardW, cardH, Math.round(36 * S));
    ctx.clip();
    const scaleCard = Math.max(cardW / coverImg.width, cardH / coverImg.height);
    const cW = coverImg.width * scaleCard;
    const cH = coverImg.height * scaleCard;
    const cX = sideMargin + (cardW - cW) / 2;
    const cY = cardY + (cardH - cH) / 2;
    ctx.drawImage(coverImg, cX, cY, cW, cH);
    // Very subtle bottom gradient on the card for separation
    const cardFade = ctx.createLinearGradient(0, cardY + cardH * 0.6, 0, cardY + cardH);
    cardFade.addColorStop(0, 'rgba(8,15,31,0)');
    cardFade.addColorStop(1, 'rgba(8,15,31,0.4)');
    ctx.fillStyle = cardFade;
    ctx.fillRect(sideMargin, cardY, cardW, cardH);
    ctx.restore();
  }

  // ── Medidas de cada sección, para poder centrar el bloque completo ─────────
  const hasOrg = Boolean(event.organization || event.community_name);
  const hasStartDate = Boolean(event.event_date);
  const hasEndDate = Boolean(event.ends_at);
  const hasLocation = Boolean(event.location);

  const titleFontSize = event.title.length > 30 ? Math.round(56 * S) : Math.round(68 * S);
  const titleLineH = titleFontSize + Math.round(16 * S);
  const titleLines = Math.ceil(event.title.length / 22);
  const gapAfterTitle = Math.round(36 * S);

  const orgPillH = Math.round(60 * S);
  const gapAfterOrg = Math.round(36 * S);

  const dateRowH = Math.round(80 * S);
  const locationRowH = Math.round(76 * S);

  const gapBeforeStats = Math.round(24 * S);
  const boxW = Math.round(310 * S), boxH = Math.round(140 * S), boxGap = Math.round(36 * S);

  const gapBeforePanel = Math.round(40 * S);
  const panelH = Math.round(168 * S);

  let blockH = titleLines * titleLineH + gapAfterTitle;
  if (hasOrg) blockH += orgPillH + gapAfterOrg;
  if (hasStartDate) blockH += dateRowH;
  if (hasLocation) blockH += locationRowH;
  blockH += gapBeforeStats + boxH;
  if (sharedBy) blockH += gapBeforePanel + panelH;

  // ── Posición vertical del bloque (se centra en el espacio disponible) ──────
  const blockTopMin = coverImg ? (cardY + cardH + Math.round(56 * S)) : 350;
  const badgeTop = H - Math.round(140 * S);
  const blockBottomMax = badgeTop - Math.round(40 * S);
  const availableSpace = blockBottomMax - blockTopMin;

  let contentY = blockTopMin;
  if (blockH < availableSpace) {
    contentY = blockTopMin + (availableSpace - blockH) / 2;
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${titleFontSize}px system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = Math.round(24 * S);
  wrapText(ctx, event.title, W / 2, contentY, cardW, titleLineH);
  ctx.shadowBlur = 0;

  let y = contentY + titleLines * titleLineH + gapAfterTitle;

  // ── Organization pill ─────────────────────────────────────────────────────
  if (hasOrg) {
    const orgText = event.organization || event.community_name;
    ctx.font = `${Math.round(36 * S)}px system-ui, sans-serif`;
    const orgPillW = ctx.measureText(orgText).width + Math.round(52 * S);
    const orgPillX = (W - orgPillW) / 2;
    ctx.fillStyle = 'rgba(251,191,36,0.18)';
    roundRect(ctx, orgPillX, y, orgPillW, orgPillH, Math.round(30 * S));
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.45)';
    ctx.lineWidth = 2;
    roundRect(ctx, orgPillX, y, orgPillW, orgPillH, Math.round(30 * S));
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.textBaseline = 'middle';
    ctx.fillText(orgText, W / 2, y + orgPillH / 2);
    y += orgPillH + gapAfterOrg;
  }

  // ── Dates ──────────────────────────────────────────────────────────────────
  const startDate = hasStartDate
    ? new Date(event.event_date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const endDate = hasEndDate
    ? new Date(event.ends_at).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  if (startDate) {
    ctx.fillStyle = 'rgba(203,213,225,0.90)';
    ctx.textBaseline = 'middle';
    const dFont = endDate ? Math.round(30 * S) : Math.round(36 * S);
    ctx.font = `${dFont}px system-ui, sans-serif`;
    const dStr = endDate ? `📅 ${startDate}   →   ${endDate}` : `📅 ${startDate}`;
    ctx.fillText(dStr, W / 2, y + Math.round(28 * S));
    y += dateRowH;
  }

  // ── Location ───────────────────────────────────────────────────────────────
  if (hasLocation) {
    ctx.fillStyle = 'rgba(203,213,225,0.85)';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(32 * S)}px system-ui, sans-serif`;
    ctx.fillText(`📍 ${event.location}`, W / 2, y + Math.round(26 * S));
    y += locationRowH;
  }

  // ── Stats boxes ───────────────────────────────────────────────────────────
  const statsY = y + gapBeforeStats;
  const statsData = [
    { value: attendeeCount || event.attendee_count || 0, label: 'planificaciones', icon: '📅' },
    { value: likeCount || event.like_count || 0, label: 'likes', icon: '♥' },
  ];
  const totalBoxW = statsData.length * boxW + (statsData.length - 1) * boxGap;
  let bx = (W - totalBoxW) / 2;

  for (const stat of statsData) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, bx, statsY, boxW, boxH, Math.round(26 * S));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, statsY, boxW, boxH, Math.round(26 * S));
    ctx.stroke();
    ctx.font = `bold ${Math.round(54 * S)}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${stat.icon} ${stat.value}`, bx + boxW / 2, statsY + Math.round(20 * S));
    ctx.font = `${Math.round(27 * S)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(148,163,184,0.80)';
    ctx.fillText(stat.label, bx + boxW / 2, statsY + Math.round(90 * S));
    bx += boxW + boxGap;
  }

  // ── "Compartido por" — mascota del usuario que comparte ────────────────────
  if (sharedBy) {
    const statsBottom = statsY + boxH;
    const panelX = sideMargin;
    const panelW = cardW;
    const maxPanelY = badgeTop - panelH - Math.round(24 * S);

    let panelY = statsBottom + gapBeforePanel;
    if (panelY > maxPanelY) {
      // Solo lo compactamos hasta el límite del badge si sigue habiendo
      // hueco suficiente respecto a las estadísticas; si no, priorizamos
      // no solapar con ellas antes que con el badge inferior.
      panelY = Math.max(statsBottom + Math.round(12 * S), maxPanelY);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, panelX, panelY, panelW, panelH, Math.round(30 * S));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, panelX, panelY, panelW, panelH, Math.round(30 * S));
    ctx.stroke();
    ctx.restore();

    const avatarSize = Math.round(128 * S);
    const avatarX = panelX + Math.round(22 * S);
    const avatarY = panelY + (panelH - avatarSize) / 2;
    const avatarCx = avatarX + avatarSize / 2;
    const avatarCy = avatarY + avatarSize / 2;
    const sharerHex = sharedBy.hex || '#38bdf8';

    // Anillo de color detrás del avatar de la mascota
    ctx.save();
    ctx.shadowColor = sharerHex;
    ctx.shadowBlur = Math.round(18 * S);
    ctx.strokeStyle = sharerHex;
    ctx.lineWidth = Math.round(4 * S);
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarSize / 2 + Math.round(6 * S), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Fondo circular + mascota recortada en círculo (estilo avatar)
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.clip();
    if (sharedBy.mascot) {
      try {
        await drawMascotOnCanvas(ctx, sharedBy.mascot, avatarX, avatarY, avatarSize, { glowColor: sharerHex });
      } catch (_) {
        // si falla, dejamos el fondo circular vacío
      }
    }
    ctx.restore();

    // Texto: "Compartido por" + nombre del usuario
    const textX = avatarX + avatarSize + Math.round(30 * S);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(203,213,225,0.75)';
    ctx.font = `${Math.round(28 * S)}px system-ui, sans-serif`;
    ctx.fillText('Compartido por', textX, panelY + panelH / 2 - Math.round(12 * S));
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(44 * S)}px system-ui, sans-serif`;
    ctx.fillText(sharedBy.username || 'Alguien', textX, panelY + panelH / 2 + Math.round(42 * S));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  // ── URL / CTA at bottom ───────────────────────────────────────────────────
  drawUrlBadge(ctx, W, H, S);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── Share / Download ──────────────────────────────────────────────────────────
// ── Share / Download ──────────────────────────────────────────────────────────

export async function shareOrDownloadBlob(blob, filename = 'story.png', title = 'SocialBattery') {
  const APP_URL = 'https://portfolio-nmc3.onrender.com';
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title,
        text: `${title}\n👉 ${APP_URL}`,
        url: APP_URL,
      });
      return { method: 'share' };
    } catch (e) {
      if (e.name === 'AbortError') return { method: 'cancelled' };
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download' };
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

/**
 * Draws a clean URL badge at the bottom of the story canvas.
 * Visible enough to read, styled as a pill with the app URL.
 */
function drawUrlBadge(ctx, W, H, scale = 1) {
  const APP_URL = 'portfolio-nmc3.onrender.com';
  const label = '🔋 ' + APP_URL;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(32 * scale)}px system-ui, sans-serif`;

  const badgeW = ctx.measureText(label).width + Math.round(64 * scale);
  const badgeH = Math.round(72 * scale);
  const badgeX = (W - badgeW) / 2;
  const badgeY = H - Math.round(140 * scale);

  // Pill background
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.round(36 * scale));
  ctx.fill();

  // Pill border
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.round(36 * scale));
  ctx.stroke();

  // Text
  ctx.fillStyle = 'rgba(226,232,240,0.85)';
  ctx.fillText(label, W / 2, badgeY + badgeH / 2);
  ctx.restore();
}

/**
 * Dibuja destellos decorativos (puntitos de brillo + estrellitas "✦")
 * repartidos por las esquinas del lienzo, coloreados con el hex del nivel
 * de batería actual, para dar un toque más vistoso/festivo a la historia
 * sin interferir con el contenido central (mascota, porcentaje, texto).
 */
function drawSparkles(ctx, W, H, hex) {
  const dots = [
    { x: 90, y: 250, r: 3, a: 0.55 },
    { x: 970, y: 230, r: 2.4, a: 0.45 },
    { x: 60, y: 470, r: 2, a: 0.35 },
    { x: 1010, y: 500, r: 2.6, a: 0.4 },
    { x: 70, y: 1420, r: 2.4, a: 0.4 },
    { x: 990, y: 1460, r: 3, a: 0.5 },
    { x: 130, y: 1620, r: 2, a: 0.3 },
    { x: 940, y: 1600, r: 2.2, a: 0.35 },
  ];
  ctx.save();
  for (const d of dots) {
    ctx.beginPath();
    ctx.fillStyle = hexToRgba(hex, d.a);
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const stars = [
    { x: 150, y: 340, size: 22, a: 0.5 },
    { x: 930, y: 360, size: 16, a: 0.4 },
    { x: 110, y: 1520, size: 18, a: 0.4 },
    { x: 960, y: 1540, size: 24, a: 0.5 },
  ];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of stars) {
    ctx.font = `${s.size}px system-ui, sans-serif`;
    ctx.fillStyle = hexToRgba(hex, s.a);
    ctx.fillText('✦', s.x, s.y);
  }
  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const clean = (hex || '#ffffff').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const bigint = parseInt(full, 16) || 0xffffff;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lineY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
