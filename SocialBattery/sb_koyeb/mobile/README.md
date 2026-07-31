# SocialBattery Mobile

Envoltorio nativo Android + iOS de SocialBattery hecho con [Capacitor](https://capacitorjs.com). Igual que la version de escritorio, **no empaqueta el backend ni Supabase**: abre la URL publica del frontend en Render dentro de un WebView nativo. Cualquier cambio que despliegues en Render aparece al instante sin recompilar la app.

Esta carpeta es totalmente independiente del `client/`, `server/` y `desktop/`. No modifica nada de esos proyectos.

---

## Requisitos

| Plataforma | Requisitos | Sistema |
|------------|-----------|---------|
| Android    | Node.js 18+, JDK 17, [Android Studio](https://developer.android.com/studio) | Windows / macOS / Linux |
| iOS        | Node.js 18+, [Xcode](https://apps.apple.com/app/xcode/id497799835) 15+, CocoaPods (`sudo gem install cocoapods`) | **Solo macOS** |

> **iOS sin Mac:** puedes preparar el proyecto en Windows y pasarselo a alguien con Mac para compilar. Tambien existen servicios en la nube como [Codemagic](https://codemagic.io) o [Appflow](https://ionic.io/appflow) que compilan iOS sin necesidad de un Mac fisico.

---

## 1. Configurar la URL de la app

```bash
cd mobile
npm run set-url -- https://portfolio-nmc3.onrender.com
```

Usa la URL real de tu frontend en Render (por defecto ya viene la actual). Este comando actualiza `package.json` y `capacitor.config.json` a la vez.

---

## 2. Instalar dependencias

```bash
cd mobile
npm install
```

---

## 3. Anadir plataformas nativas (solo la primera vez)

### Android
```bash
npm run add:android
```
Esto crea la carpeta `android/` con el proyecto Gradle. Solo hay que hacerlo una vez.

### iOS (solo en Mac)
```bash
npm run add:ios
```
Esto crea la carpeta `ios/` con el workspace de Xcode.

> Las carpetas `android/` y `ios/` **no se suben al repo** (estan en el `.gitignore`). Se generan localmente. Si otra persona clona el proyecto en su Mac, solo tiene que repetir el paso 2 y luego `npm run add:ios`.

---

## 4. Sincronizar cambios de config

Cada vez que cambies la URL, iconos, plugins o `capacitor.config.json`:

```bash
npm run sync
```

---

## 5. Probar en un dispositivo/emulador

### Android
1. Conecta un movil Android con **depuracion USB** activada, o abre un emulador desde Android Studio.
2. Ejecuta:
   ```bash
   npm run run:android
   ```
3. Alternativamente, abre el proyecto en Android Studio:
   ```bash
   npm run open:android
   ```
   y pulsa el boton "Run".

### iOS (solo en Mac)
1. Conecta un iPhone o abre el simulador de Xcode.
2. Ejecuta:
   ```bash
   npm run run:ios
   ```
3. Alternativamente:
   ```bash
   npm run open:ios
   ```
   y compila desde Xcode.

---

## 6. Generar APK / IPA para distribuir

### Android — APK de release

```bash
npm run build:android
```
El APK sale en:
```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Sin firma comercial este APK se puede instalar activando "Origenes desconocidos" en el movil. Para publicar en Play Store necesitas [firmarlo](https://developer.android.com/studio/publish/app-signing) y generar un `.aab` con `./gradlew bundleRelease`.

### Android — APK de debug (mas rapido para pruebas)

```bash
npm run build:android:debug
```
Sale en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Se puede instalar directamente en un movil de pruebas.

### iOS — IPA (solo en Mac con cuenta Apple Developer $99/ano)

Abre Xcode con `npm run open:ios`, selecciona tu equipo firmante en "Signing & Capabilities", y usa **Product > Archive**.

---

## Iconos y splash screen

Los iconos por defecto vienen de `assets/icon.png` (256x256). Para generar automaticamente todas las resoluciones que necesita cada plataforma:

```bash
npm install --save-dev @capacitor/assets
# coloca un icon.png de 1024x1024 y opcionalmente splash.png de 2732x2732 en assets/
npx capacitor-assets generate --iconBackgroundColor '#0a0a0f' --splashBackgroundColor '#0a0a0f'
```

Esto crea los assets correctos dentro de `android/` y `ios/`.

---

## Permisos y plugins

Ya vienen preconfigurados los plugins mas comunes:

| Plugin | Uso |
|--------|-----|
| `@capacitor/app` | Estado de la app (background/foreground) |
| `@capacitor/browser` | Abrir enlaces externos en navegador nativo |
| `@capacitor/push-notifications` | Notificaciones push (fase 8 del backend) |
| `@capacitor/splash-screen` | Pantalla de carga inicial |
| `@capacitor/status-bar` | Color de la barra de estado |

Cuando actives push notifications reales:
- **Android**: anade `google-services.json` a `android/app/`.
- **iOS**: activa la capability "Push Notifications" en Xcode y sube el certificado APNs a Firebase.

---

## Estructura

```
mobile/
├── package.json              # Deps de Capacitor + scripts
├── capacitor.config.json     # Config Capacitor (URL, plugins, plataformas)
├── www/index.html            # Placeholder mientras carga la URL remota
├── assets/                   # Iconos base
├── scripts/
│   ├── set-app-url.js        # Cambia la URL de Render
│   ├── check-app-url.js      # Verifica que la URL responde
│   └── apply-config.js       # Sincroniza package.json -> capacitor.config.json
├── android/                  # (generado por `npm run add:android`, ignorado en git)
└── ios/                      # (generado por `npm run add:ios`, ignorado en git)
```

---

## Preguntas frecuentes

**No tengo Mac. ¿Puedo publicar en App Store?**
Necesitas un Mac para el paso final (Archive + Upload). Alternativas: pedir a alguien con Mac que lo compile, alquilar un Mac en la nube ([MacInCloud](https://www.macincloud.com/), [MacStadium](https://www.macstadium.com/)) o usar un servicio de CI como Codemagic/Appflow.

**¿Se rompe la app web actual?**
No. Esta carpeta es 100% independiente. El WebView carga exactamente la misma URL que abres en el navegador.

**¿Y las notificaciones push del navegador?**
La Web Push del `sw.js` funciona en Chrome/Firefox pero no dentro del WebView de una app. Para notificaciones push nativas en Android/iOS usa el plugin `@capacitor/push-notifications` (ya incluido) + Firebase Cloud Messaging.

**¿Como actualizo la app despues de un cambio en Render?**
Como carga la URL en vivo, cualquier deploy en Render se ve al instante al reabrir la app. Solo necesitas recompilar si cambias plugins nativos, iconos o la URL base.
