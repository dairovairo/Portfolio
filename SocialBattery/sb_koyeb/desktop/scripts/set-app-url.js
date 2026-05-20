const fs = require('fs');
const path = require('path');

const appUrl = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!appUrl) {
  fail('Uso: npm.cmd run set-url -- https://tu-app.onrender.com');
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

const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.appUrl = parsed.href.replace(/\/$/, '');
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`SocialBattery desktop usara: ${packageJson.appUrl}`);
