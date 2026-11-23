const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? 'gradlew.bat' : './gradlew';
const androidDir = path.join(__dirname, '..', 'android');
const args = process.argv.slice(2);

// Ruta absoluta: con un nombre relativo, cmd.exe lanzado desde Git Bash no
// encuentra gradlew.bat ("no se reconoce como un comando...").
const result = spawnSync(`"${path.join(androidDir, gradleCommand)}"`, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
