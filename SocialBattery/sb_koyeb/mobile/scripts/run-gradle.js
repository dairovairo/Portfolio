const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? 'gradlew.bat' : './gradlew';
const androidDir = path.join(__dirname, '..', 'android');
const args = process.argv.slice(2);

const result = spawnSync(gradleCommand, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
