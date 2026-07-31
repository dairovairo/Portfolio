const fs = require('fs');
const path = require('path');

const appUrl = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!appUrl) {
  fail('Uso: npm run set-url -- https://tu-app.onrender.com');
}

let parsed;
try {
  parsed = new URL(appUrl);
} catch {
  fail('La URL no es valida.');
}

if (parsed.protocol !== 'https:') {
  fail('Usa la URL HTTPS publica de Render.');
}

const placeholderWords = ['cambia-esto', 'tu-frontend', 'example'];
if (placeholderWords.some(word => parsed.hostname.toLowerCase().includes(word))) {
  fail('Esa URL parece de ejemplo. Usa la URL real de tu frontend en Render.');
}

const cleanUrl = parsed.href.replace(/\/$/, '');

const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.appUrl = cleanUrl;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const capacitorConfigPath = path.join(__dirname, '..', 'capacitor.config.json');
const capacitorConfig = JSON.parse(fs.readFileSync(capacitorConfigPath, 'utf8'));
capacitorConfig.server = capacitorConfig.server || {};
capacitorConfig.server.url = cleanUrl;
fs.writeFileSync(capacitorConfigPath, `${JSON.stringify(capacitorConfig, null, 2)}\n`);

console.log(`SocialBattery mobile usara: ${cleanUrl}`);
console.log('Recuerda ejecutar "npm run sync" si ya has anadido plataformas.');
