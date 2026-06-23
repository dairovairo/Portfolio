const packageJson = require('../package.json');

const appUrl = process.env.SOCIALBATTERY_APP_URL || packageJson.appUrl;

function fail(message) {
  console.error(message);
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(appUrl);
} catch {
  fail('La URL configurada no es valida. Ejecuta: npm.cmd run set-url -- https://tu-app.onrender.com');
}

const placeholderWords = ['cambia-esto', 'tu-frontend', 'example'];
if (parsed.protocol !== 'https:' || placeholderWords.some(word => parsed.hostname.toLowerCase().includes(word))) {
  fail('Configura primero la URL real de Render: npm.cmd run set-url -- https://tu-app.onrender.com');
}

(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(parsed.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'SocialBattery desktop build check' },
    });

    if (!response.ok) {
      fail(`La URL responde ${response.status}. Revisa que sea el frontend real de Render: ${parsed.href}`);
    }

    console.log(`URL comprobada: ${parsed.href}`);
  } catch (error) {
    fail(`No se pudo comprobar la URL de Render (${error.message}). Revisa: ${parsed.href}`);
  } finally {
    clearTimeout(timeout);
  }
})();
