/**
 * Instagram Story sharing utilities
 * Generates a canvas-based image for Instagram Stories using web_share API
 * or falls back to downloading the image.
 */

import { getBatteryColor } from './battery';

// ── Battery Story ──────────────────────────────────────────────────────────────

export async function generateBatteryStoryBlob({ level, label, hex, username, updatedAt }) {
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

  // Ambient glow behind battery
  const cx = W / 2;
  const batteryY = 580; // center Y of the battery body
  const glow = ctx.createRadialGradient(cx, batteryY, 0, cx, batteryY, 520);
  glow.addColorStop(0, `${hex}28`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

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

  // ── Battery shape ──────────────────────────────────────────────────────────
  const bW = 520;   // body width
  const bH = 280;   // body height
  const bR = 40;    // body corner radius
  const bX = (W - bW) / 2;
  const bY = batteryY - bH / 2;

  // Nub (positive terminal) on the right
  const nubW = 32, nubH = 90;
  const nubX = bX + bW;
  const nubY = batteryY - nubH / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, nubX, nubY, nubW, nubH, 10);
  ctx.fill();

  // Battery body outline (glass-like)
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, bX, bY, bW, bH, bR);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 4;
  roundRect(ctx, bX, bY, bW, bH, bR);
  ctx.stroke();

  // Fill level inside battery
  const padding = 14;
  const fillMaxW = bW - padding * 2;
  const fillW = Math.max(0, fillMaxW * (level / 100));
  const fillX = bX + padding;
  const fillY = bY + padding;
  const fillH = bH - padding * 2;
  const fillR = bR - 6;

  if (fillW > 0) {
    // Gradient fill
    const fillGrad = ctx.createLinearGradient(fillX, 0, fillX + fillMaxW, 0);
    fillGrad.addColorStop(0, `${hex}cc`);
    fillGrad.addColorStop(1, hex);
    ctx.fillStyle = fillGrad;
    // Clip fill to battery body inner area
    ctx.save();
    roundRect(ctx, fillX, fillY, fillMaxW, fillH, fillR);
    ctx.clip();
    // Draw fill rect (possibly partial)
    const clippedFillR = fillW >= fillMaxW ? fillR : Math.min(fillR, fillW / 2);
    roundRect(ctx, fillX, fillY, fillW, fillH, clippedFillR);
    ctx.fill();

    // Shine highlight on top of fill
    const shine = ctx.createLinearGradient(0, fillY, 0, fillY + fillH * 0.5);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    roundRect(ctx, fillX, fillY, fillW, fillH * 0.5, clippedFillR);
    ctx.fill();
    ctx.restore();

    // Inner glow on fill edges
    ctx.shadowColor = hex;
    ctx.shadowBlur = 28;
    ctx.strokeStyle = `${hex}80`;
    ctx.lineWidth = 2;
    ctx.save();
    roundRect(ctx, fillX, fillY, fillMaxW, fillH, fillR);
    ctx.clip();
    roundRect(ctx, fillX, fillY, fillW, fillH, clippedFillR);
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // Segment dividers inside battery (subtle)
  const segments = 4;
  for (let i = 1; i < segments; i++) {
    const sx = bX + padding + (fillMaxW / segments) * i;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, bY + padding + 4);
    ctx.lineTo(sx, bY + bH - padding - 4);
    ctx.stroke();
  }

  // ── Percentage number ──────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 220px system-ui, sans-serif';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 50;
  ctx.fillText(`${level}%`, cx, batteryY + bH / 2 + 200);
  ctx.shadowBlur = 0;

  // ── Status label pill ──────────────────────────────────────────────────────
  const labelY2 = batteryY + bH / 2 + 380;
  ctx.font = 'bold 48px system-ui, sans-serif';
  const labelW = ctx.measureText(label).width + 72;
  const labelH = 80;
  const labelX = (W - labelW) / 2;
  ctx.fillStyle = `${hex}22`;
  roundRect(ctx, labelX, labelY2, labelW, labelH, 40);
  ctx.fill();
  ctx.strokeStyle = `${hex}66`;
  ctx.lineWidth = 2.5;
  roundRect(ctx, labelX, labelY2, labelW, labelH, 40);
  ctx.stroke();
  ctx.fillStyle = hex;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, labelY2 + labelH / 2);

  // ── Username ───────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = 'bold 52px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(username || 'Mi batería social', W / 2, labelY2 + labelH + 90);

  // ── Date ──────────────────────────────────────────────────────────────────
  if (updatedAt) {
    const dateStr = new Date(updatedAt).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    ctx.fillStyle = 'rgba(148,163,184,0.65)';
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillText(dateStr, W / 2, labelY2 + labelH + 170);
  }

  // ── Watermark ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillText('socialbattery.app', W / 2, H - 100);

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

  // ── Watermark ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(203,213,225,0.35)';
  ctx.font = '30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('socialbattery.app', W / 2, H - 100);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── Share / Download ──────────────────────────────────────────────────────────

export async function shareOrDownloadBlob(blob, filename = 'story.png', title = 'SocialBattery') {
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
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
