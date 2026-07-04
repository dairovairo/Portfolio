/**
 * Instagram Story sharing utilities
 * Generates a canvas-based image for Instagram Stories using web_share API
 * or falls back to downloading the image.
 */

import { getBatteryColor } from './battery';
import { drawMascotOnCanvas } from './mascotRenderer';

// ── Battery Story ──────────────────────────────────────────────────────────────

export async function generateBatteryStoryBlob({ level, label, hex, username, updatedAt, mascot }) {
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

export async function generateEventStoryBlob({ event, attendeeCount, likeCount }) {
  const W = 1080;
  const H = 1920;

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

  // ── App branding (bigger pill at top) ──────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pillW = 380, pillH = 80, pillX = (W - pillW) / 2, pillY = 130;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, pillX, pillY, pillW, pillH, 40);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, 40);
  ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('🔋 SocialBattery', W / 2, pillY + pillH / 2);

  // ── Cover image card (non-blurred, sharp) ─────────────────────────────────
  let contentY = 320;
  if (coverImg) {
    const cardH = 500;
    const cardY = 270;
    ctx.save();
    roundRect(ctx, 80, cardY, W - 160, cardH, 36);
    ctx.clip();
    const scaleCard = Math.max((W - 160) / coverImg.width, cardH / coverImg.height);
    const cW = coverImg.width * scaleCard;
    const cH = coverImg.height * scaleCard;
    const cX = 80 + ((W - 160) - cW) / 2;
    const cY = cardY + (cardH - cH) / 2;
    ctx.drawImage(coverImg, cX, cY, cW, cH);
    // Very subtle bottom gradient on the card for separation
    const cardFade = ctx.createLinearGradient(0, cardY + cardH * 0.6, 0, cardY + cardH);
    cardFade.addColorStop(0, 'rgba(8,15,31,0)');
    cardFade.addColorStop(1, 'rgba(8,15,31,0.4)');
    ctx.fillStyle = cardFade;
    ctx.fillRect(80, cardY, W - 160, cardH);
    ctx.restore();
    contentY = cardY + cardH + 56;
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  const titleFontSize = event.title.length > 30 ? 56 : 68;
  const titleLineH = titleFontSize + 16;
  ctx.font = `bold ${titleFontSize}px system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 24;
  wrapText(ctx, event.title, W / 2, contentY, W - 160, titleLineH);
  ctx.shadowBlur = 0;

  const titleLines = Math.ceil(event.title.length / 26);
  let y = contentY + titleLines * titleLineH + 36;

  // ── Organization pill ─────────────────────────────────────────────────────
  if (event.organization || event.community_name) {
    const orgText = event.organization || event.community_name;
    ctx.font = '36px system-ui, sans-serif';
    const orgPillW = ctx.measureText(orgText).width + 52;
    const orgPillH = 60;
    const orgPillX = (W - orgPillW) / 2;
    ctx.fillStyle = 'rgba(251,191,36,0.18)';
    roundRect(ctx, orgPillX, y, orgPillW, orgPillH, 30);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.45)';
    ctx.lineWidth = 2;
    roundRect(ctx, orgPillX, y, orgPillW, orgPillH, 30);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.textBaseline = 'middle';
    ctx.fillText(orgText, W / 2, y + orgPillH / 2);
    y += orgPillH + 36;
  }

  // ── Dates ──────────────────────────────────────────────────────────────────
  const startDate = event.event_date
    ? new Date(event.event_date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const endDate = event.ends_at
    ? new Date(event.ends_at).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  if (startDate) {
    ctx.fillStyle = 'rgba(203,213,225,0.90)';
    ctx.textBaseline = 'middle';
    const dFont = endDate ? '30px' : '36px';
    ctx.font = `${dFont} system-ui, sans-serif`;
    const dStr = endDate ? `📅 ${startDate}   →   ${endDate}` : `📅 ${startDate}`;
    ctx.fillText(dStr, W / 2, y + 28);
    y += 80;
  }

  // ── Stats boxes ───────────────────────────────────────────────────────────
  const statsY = y + 24;
  const statsData = [
    { value: attendeeCount || event.attendee_count || 0, label: 'planificaciones', icon: '📅' },
    { value: likeCount || event.like_count || 0, label: 'likes', icon: '♥' },
  ];
  const boxW = 310, boxH = 140, gap = 36;
  const totalBoxW = statsData.length * boxW + (statsData.length - 1) * gap;
  let bx = (W - totalBoxW) / 2;

  for (const stat of statsData) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(ctx, bx, statsY, boxW, boxH, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, statsY, boxW, boxH, 26);
    ctx.stroke();
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${stat.icon} ${stat.value}`, bx + boxW / 2, statsY + 20);
    ctx.font = '27px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.80)';
    ctx.fillText(stat.label, bx + boxW / 2, statsY + 90);
    bx += boxW + gap;
  }

  // ── URL / CTA at bottom ───────────────────────────────────────────────────
  drawUrlBadge(ctx, W, H);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

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
function drawUrlBadge(ctx, W, H) {
  const APP_URL = 'portfolio-nmc3.onrender.com';
  const label = '🔋 ' + APP_URL;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 32px system-ui, sans-serif';

  const badgeW = ctx.measureText(label).width + 64;
  const badgeH = 72;
  const badgeX = (W - badgeW) / 2;
  const badgeY = H - 140;

  // Pill background
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 36);
  ctx.fill();

  // Pill border
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 36);
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
