const { existsSync } = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const hasAndroid = existsSync(path.join(root, 'android'));
const hasIos = existsSync(path.join(root, 'ios'));

if (!hasAndroid && !hasIos) {
  console.log('No hay plataformas nativas todavia (android/ o ios/). Los iconos se generaran al anadir una plataforma con add:android / add:ios.');
  process.exit(0);
}

const flags = [];
if (hasAndroid) flags.push('--android');
if (hasIos) flags.push('--ios');

const cmd = [
  'npx capacitor-assets generate',
  ...flags,
  '--iconBackgroundColor "#0a0a0f"',
  '--iconBackgroundColorDark "#0a0a0f"',
  '--splashBackgroundColor "#0a0a0f"',
  '--splashBackgroundColorDark "#0a0a0f"',
].join(' ');

execSync(cmd, { stdio: 'inherit', cwd: root });
