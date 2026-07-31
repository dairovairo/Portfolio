const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const capacitorConfigPath = path.join(__dirname, '..', 'capacitor.config.json');
const capacitorConfig = JSON.parse(fs.readFileSync(capacitorConfigPath, 'utf8'));

let changed = false;

if (packageJson.appId && capacitorConfig.appId !== packageJson.appId) {
  capacitorConfig.appId = packageJson.appId;
  changed = true;
}

if (packageJson.appName && capacitorConfig.appName !== packageJson.appName) {
  capacitorConfig.appName = packageJson.appName;
  changed = true;
}

if (packageJson.appUrl) {
  capacitorConfig.server = capacitorConfig.server || {};
  if (capacitorConfig.server.url !== packageJson.appUrl) {
    capacitorConfig.server.url = packageJson.appUrl;
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(capacitorConfigPath, `${JSON.stringify(capacitorConfig, null, 2)}\n`);
  console.log('capacitor.config.json sincronizado desde package.json');
}
