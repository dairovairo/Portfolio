const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const packageJson = require('./package.json');

const APP_URL = process.env.SOCIALBATTERY_APP_URL || packageJson.appUrl;

function isValidAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.hostname.includes('cambia-esto');
  } catch {
    return false;
  }
}

function renderSetupHtml() {
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SocialBattery</title>
        <style>
          :root { color-scheme: dark; font-family: Arial, sans-serif; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #0a0a0f;
            color: #f7f7fb;
          }
          main {
            width: min(420px, calc(100vw - 32px));
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 18px;
            padding: 28px;
            background: #15151e;
            box-shadow: 0 20px 70px rgba(0,0,0,.35);
          }
          h1 { margin: 0 0 8px; font-size: 28px; }
          p { color: #b7b7c7; line-height: 1.5; }
          code {
            display: block;
            margin-top: 16px;
            padding: 12px;
            border-radius: 12px;
            background: #0a0a0f;
            color: #c4b5fd;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>SocialBattery</h1>
          <p>Falta configurar la URL publica de Render antes de generar el ejecutable.</p>
          <code>"appUrl": "https://tu-app.onrender.com"</code>
        </main>
      </body>
    </html>
  `;
}

function renderHttpErrorHtml(statusCode, failedUrl) {
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SocialBattery</title>
        <style>
          :root { color-scheme: dark; font-family: Arial, sans-serif; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #0a0a0f;
            color: #f7f7fb;
          }
          main {
            width: min(460px, calc(100vw - 32px));
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 18px;
            padding: 28px;
            background: #15151e;
          }
          h1 { margin: 0 0 8px; font-size: 28px; }
          p { color: #b7b7c7; line-height: 1.5; }
          code {
            display: block;
            margin-top: 16px;
            padding: 12px;
            border-radius: 12px;
            background: #0a0a0f;
            color: #c4b5fd;
            word-break: break-all;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>URL de SocialBattery no encontrada</h1>
          <p>La app de escritorio esta apuntando a una URL que responde ${statusCode}. Configura la URL real del frontend en Render y vuelve a generar el ejecutable.</p>
          <code>${escapeHtml(failedUrl)}</code>
        </main>
      </body>
    </html>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createWindow() {
  const appOrigin = isValidAppUrl(APP_URL) ? new URL(APP_URL).origin : null;

  const win = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 360,
    minHeight: 640,
    title: 'SocialBattery',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const targetOrigin = new URL(url).origin;
    if (appOrigin && targetOrigin === appOrigin) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!appOrigin) return;
    const targetOrigin = new URL(url).origin;
    if (targetOrigin === appOrigin) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderOfflineHtml())}`);
  });

  win.webContents.session.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (
      details.resourceType === 'mainFrame' &&
      appOrigin &&
      new URL(details.url).origin === appOrigin &&
      details.statusCode >= 400
    ) {
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHttpErrorHtml(details.statusCode, details.url))}`);
    }
    callback({});
  });

  if (isValidAppUrl(APP_URL)) {
    win.loadURL(APP_URL);
  } else {
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSetupHtml())}`);
  }
}

function renderOfflineHtml() {
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SocialBattery</title>
        <style>
          :root { color-scheme: dark; font-family: Arial, sans-serif; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #0a0a0f;
            color: #f7f7fb;
          }
          main {
            width: min(420px, calc(100vw - 32px));
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 18px;
            padding: 28px;
            background: #15151e;
          }
          h1 { margin: 0 0 8px; font-size: 28px; }
          p { color: #b7b7c7; line-height: 1.5; }
          button {
            border: 0;
            border-radius: 12px;
            padding: 12px 16px;
            background: #7c3aed;
            color: white;
            font-weight: 700;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>No se pudo abrir SocialBattery</h1>
          <p>Comprueba tu conexion o espera unos segundos si Render/Railway esta despertando.</p>
          <button onclick="location.reload()">Reintentar</button>
        </main>
      </body>
    </html>
  `;
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.socialbattery.app');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
