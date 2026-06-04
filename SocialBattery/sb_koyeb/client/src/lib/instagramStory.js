/**
 * Instagram Story sharing utilities
 * Generates a canvas-based image for Instagram Stories using web_share API
 * or falls back to downloading the image.
 */

import { getBatteryColor } from './battery';

/**
 * Draws the battery story canvas and returns a Blob
 * @param {object} opts
 * @param {number} opts.level - Battery level 0-100
 * @param {string} opts.label - Battery label (e.g. "Cargado")
 * @param {string} opts.hex - Color hex for the battery level
 * @param {string} opts.username - User's display name or username
 * @param {string} opts.updatedAt - ISO date string of last update
 * @returns {Promise<Blob>}
 */
export async function generateBatteryStoryBlob({ level, label, hex, username, updatedAt }) {
  const W = 1080;
  const H = 1920;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.5, '#1e293b');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridSize = 80;
  for (let x = 0; x <= W; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Glow radial behind number
  const cx = W / 2;
  const cy = H / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 500);
  glow.addColorStop(0, `${hex}30`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // App name pill at top
  const pillW = 260, pillH = 60, pillX = (W - pillW) / 2, pillY = 180;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, pillX, pillY, pillW, pillH, 30);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, pillX, pillY, pillW, pillH, 30);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🔋 SocialBattery', W / 2, pillY + 40);

  // Circle background ring
  const radius = 280;
  ctx.beginPath();
  ctx.arc(cx, cy - 60, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 24;
  ctx.stroke();

  // Arc progress (battery level)
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (level / 100) * Math.PI * 2;
  const arcGrad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
  arcGrad.addColorStop(0, `${hex}cc`);
  arcGrad.addColorStop(1, hex);
  ctx.beginPath();
  ctx.arc(cx, cy - 60, radius, startAngle, endAngle);
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth = 24;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Big percentage number
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 240px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 60;
  ctx.fillText(`${level}`, cx, cy - 60);
  ctx.shadowBlur = 0;

  // Percent sign
  ctx.font = 'bold 80px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textBaseline = 'bottom';
  const numW = ctx.measureText(`${level}`).width * 1.25; // rough scale from 240
  // Properly measure the large number
  ctx.font = `bold 240px system-ui, sans-serif`;
  const bigMetrics = ctx.measureText(`${level}`);
  ctx.font = 'bold 80px system-ui, sans-serif';
  ctx.fillText('%', cx + bigMetrics.width / 2 + 20, cy - 60 + 120);

  // Label pill
  ctx.textBaseline = 'middle';
  const labelText = label;
  ctx.font = 'bold 44px system-ui, sans-serif';
  const labelW = ctx.measureText(labelText).width + 64;
  const labelH = 70;
  const labelX = (W - labelW) / 2;
  const labelY = cy + 270;
  ctx.fillStyle = `${hex}22`;
  roundRect(ctx, labelX, labelY, labelW, labelH, 35);
  ctx.fill();
  ctx.strokeStyle = `${hex}55`;
  ctx.lineWidth = 2;
  roundRect(ctx, labelX, labelY, labelW, labelH, 35);
  ctx.stroke();
  ctx.fillStyle = hex;
  ctx.textAlign = 'center';
  ctx.fillText(labelText, W / 2, labelY + labelH / 2);

  // Username
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(username || 'Mi batería social', W / 2, labelY + labelH + 80);

  // Date
  if (updatedAt) {
    const dateStr = new Date(updatedAt).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '34px system-ui, sans-serif';
    ctx.fillText(dateStr, W / 2, labelY + labelH + 150);
  }

  // Bottom watermark
  ctx.fillStyle = 'rgba(148,163,184,0.4)';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText('socialbattery.app', W / 2, H - 120);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Draws an event story canvas and returns a Blob
 */
export async function generateEventStoryBlob({ event, attendeeCount, likeCount }) {
  const W = 1080;
  const H = 1920;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Dark background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.6, '#1e293b');
  bg.addColorStop(1, '#0c1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle texture
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // App name at top
  const pillW = 260, pillH = 60, pillX = (W - pillW) / 2, pillY = 120;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, pillX, pillY, pillW, pillH, 30);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, pillX, pillY, pillW, pillH, 30);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🔋 SocialBattery', W / 2, pillY + 40);

  // Cover image if available
  let coverLoaded = false;
  if (event.cover_image_url) {
    try {
      const img = await loadImage(event.cover_image_url);
      const imgH = 560;
      const imgY = 240;
      // Draw rounded rect clipping
      ctx.save();
      roundRect(ctx, 80, imgY, W - 160, imgH, 36);
      ctx.clip();
      // Cover fit
      const scale = Math.max((W - 160) / img.width, imgH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const drawX = 80 + ((W - 160) - drawW) / 2;
      const drawY = imgY + (imgH - drawH) / 2;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      // Overlay gradient on cover
      const coverOverlay = ctx.createLinearGradient(0, imgY, 0, imgY + imgH);
      coverOverlay.addColorStop(0, 'rgba(15,23,42,0.1)');
      coverOverlay.addColorStop(1, 'rgba(15,23,42,0.8)');
      ctx.fillStyle = coverOverlay;
      ctx.fillRect(80, imgY, W - 160, imgH);
      ctx.restore();
      coverLoaded = true;
    } catch (e) {
      // skip image if it fails to load
    }
  }

  const contentY = coverLoaded ? 860 : 320;

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${event.title.length > 30 ? 52 : 64}px system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 20;
  wrapText(ctx, event.title, W / 2, contentY, W - 160, event.title.length > 30 ? 70 : 80);
  ctx.shadowBlur = 0;

  // Title line count to offset subsequent items
  const titleLines = Math.ceil(event.title.length / 28);
  const titleBlockH = titleLines * (event.title.length > 30 ? 70 : 80);

  let y = contentY + titleBlockH + 32;

  // Organization pill
  if (event.organization || event.community_name) {
    const orgText = event.organization || event.community_name;
    ctx.font = '34px system-ui, sans-serif';
    const orgW = ctx.measureText(orgText).width + 48;
    const orgH = 56;
    const orgX = (W - orgW) / 2;
    ctx.fillStyle = 'rgba(251,191,36,0.15)';
    roundRect(ctx, orgX, y, orgW, orgH, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, orgX, y, orgW, orgH, 28);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.textBaseline = 'middle';
    ctx.fillText(orgText, W / 2, y + orgH / 2);
    y += orgH + 32;
  }

  // Date range
  const startDate = event.event_date ? new Date(event.event_date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const endDate = event.ends_at ? new Date(event.ends_at).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  if (startDate) {
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.textBaseline = 'middle';
    const dateStr = endDate ? `📅 ${startDate}  →  ${endDate}` : `📅 ${startDate}`;
    ctx.font = endDate ? '30px system-ui, sans-serif' : '36px system-ui, sans-serif';
    ctx.fillText(dateStr, W / 2, y + 28);
    y += 80;
  }

  // Stats row
  const statsY = y + 20;
  const statsData = [
    { value: attendeeCount || event.attendee_count || 0, label: 'planificaciones', icon: '📅' },
    { value: likeCount || event.like_count || 0, label: 'likes', icon: '♥' },
  ];

  const boxW = 300;
  const boxH = 130;
  const gap = 40;
  const totalW = statsData.length * boxW + (statsData.length - 1) * gap;
  let bx = (W - totalW) / 2;

  for (const stat of statsData) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, bx, statsY, boxW, boxH, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, statsY, boxW, boxH, 24);
    ctx.stroke();

    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${stat.icon} ${stat.value}`, bx + boxW / 2, statsY + 18);
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.fillText(stat.label, bx + boxW / 2, statsY + 82);
    bx += boxW + gap;
  }

  // "Me apunté" / "Me gusta" badge
  y = statsY + boxH + 48;
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('¡Me apunto a esto!', W / 2, y);

  // Bottom watermark
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText('socialbattery.app', W / 2, H - 120);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Share or download a blob as an image
 */
export async function shareOrDownloadBlob(blob, filename = 'story.png', title = 'SocialBattery') {
  const file = new File([blob], filename, { type: 'image/png' });

  // Try native share (mobile)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return { method: 'share' };
    } catch (e) {
      if (e.name !== 'AbortError') {
        // fall through to download
      } else {
        return { method: 'cancelled' };
      }
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download' };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = testLine;
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
