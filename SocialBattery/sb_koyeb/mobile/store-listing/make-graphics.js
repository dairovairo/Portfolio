// Genera los gráficos de la ficha de Google Play a partir de assets/icon.png.
//   node store-listing/make-graphics.js
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const icon = path.join(root, 'assets', 'icon.png');
const out = (f) => path.join(__dirname, f);

async function main() {
  // Icono de la ficha: 512×512 PNG de 32 bits.
  await sharp(icon).resize(512, 512).png().toFile(out('icon-512.png'));

  // Gráfico destacado: 1024×500, sin transparencia.
  const W = 1024, H = 500;
  const bg = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="28%" cy="50%" r="75%">
          <stop offset="0%" stop-color="#0f5a60"/>
          <stop offset="55%" stop-color="#0b1f26"/>
          <stop offset="100%" stop-color="#070d12"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="470" y="215" font-family="Segoe UI, Arial, sans-serif" font-size="68" font-weight="700" fill="#F4F1EA">SocialBattery</text>
      <text x="472" y="275" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#7FE3E8">Sé honesto con tu energía social</text>
      <text x="472" y="330" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#A9B8BD">Amigos · Quedadas · Eventos · Comunidades</text>
    </svg>`);
  const mask = Buffer.from('<svg width="380" height="380"><rect width="380" height="380" rx="84" ry="84"/></svg>');
  const iconBuf = await sharp(icon).resize(380, 380)
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await sharp(bg)
    .composite([{ input: iconBuf, left: 60, top: 60 }])
    .flatten({ background: '#070d12' })
    .removeAlpha()
    .png()
    .toFile(out('feature-graphic-1024x500.png'));
  console.log('ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
