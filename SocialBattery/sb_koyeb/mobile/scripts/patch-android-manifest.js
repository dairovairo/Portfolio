/**
 * Inserta en android/app/src/main/AndroidManifest.xml el intent-filter del
 * deep link de vuelta del login OAuth (com.socialbattery.app://login-callback).
 *
 * La carpeta android/ está en .gitignore (se genera con `npx cap add android`),
 * así que cualquier cambio a mano en el manifest se pierde al regenerarla.
 * Este script es idempotente y se ejecuta en `npm run sync`.
 */
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const MARKER = 'android:host="login-callback"';

if (!fs.existsSync(manifestPath)) {
  console.log('[patch-android-manifest] android/ no existe todavía, nada que parchear.');
  process.exit(0);
}

let xml = fs.readFileSync(manifestPath, 'utf8');
if (xml.includes(MARKER)) {
  console.log('[patch-android-manifest] deep link OAuth ya presente.');
  process.exit(0);
}

const filter = `
            <!-- Deep link de vuelta del login OAuth (Google/Apple) — ver client/src/lib/nativeAuth.js -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.socialbattery.app" ${MARKER} />
            </intent-filter>
        </activity>`;

// Solo la primera </activity> (MainActivity, la única que genera Capacitor).
const idx = xml.indexOf('</activity>');
if (idx === -1) {
  console.error('[patch-android-manifest] no se encontró </activity> en el manifest.');
  process.exit(1);
}
xml = xml.slice(0, idx) + filter.trimStart() + xml.slice(idx + '</activity>'.length);
fs.writeFileSync(manifestPath, xml);
console.log('[patch-android-manifest] deep link OAuth añadido al manifest.');
