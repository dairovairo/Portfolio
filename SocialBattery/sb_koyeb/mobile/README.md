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

El icono de la app es `assets/icon.png` (el mismo logo de bateria que usa la PWA, 512x512). Ya **no hace falta generarlo a mano**: `npm run sync` (y por tanto `add:android`, `add:ios` y `build:android`) ejecuta automaticamente `npm run gen:icons`, que usa `@capacitor/assets` para regenerar todas las resoluciones (`mipmap-*` en Android, `AppIcon.appiconset` en iOS) a partir de `assets/icon.png`.

> Si ya tenias una carpeta `android/` generada antes de este cambio, el icono viejo se quedo cacheado en `android/app/src/main/res/mipmap-*`. Corre `npm run gen:icons` (o `npm run sync`) una vez y vuelve a compilar (`npm run build:android`) para que el APK lleve el icono correcto.

Para cambiar el icono en el futuro, sustituye `assets/icon.png` por uno cuadrado (idealmente 1024x1024) y vuelve a correr `npm run gen:icons`.

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

Cuando actives push notifications reales (necesario para que las notificaciones lleguen con la app en 2º plano o cerrada — ver detalle tecnico en `server/lib/fcm.js`):

1. Crea/reutiliza un proyecto en [Firebase Console](https://console.firebase.google.com).
2. Anade una app Android con el package name `com.socialbattery.app` (debe coincidir con `appId` en `capacitor.config.json`).
3. Descarga `google-services.json` y colocalo en `android/app/google-services.json` (se pierde al borrar `android/`, hay que repetir este paso si vuelves a correr `add:android` desde cero).
4. Project settings → Service accounts → Generate new private key, y pon ese JSON en `FIREBASE_SERVICE_ACCOUNT_JSON` (o `FIREBASE_SERVICE_ACCOUNT_BASE64`) en `server/.env` — es lo que usa el backend para *enviar* las notificaciones.
5. Corre `supabase_schema_phase133_fcm_tokens.sql` en el SQL Editor de Supabase (tabla donde se guardan los tokens de dispositivo).
6. `npm run sync` para que Gradle recoja el `google-services.json` nuevo.
7. **iOS**: activa la capability "Push Notifications" en Xcode y sube el certificado/clave APNs a Firebase (Project settings → Cloud Messaging → Apple app configuration).

El cliente web (`client/src/lib/capacitorPush.js`) ya pide permiso y registra el token automaticamente al iniciar sesion dentro de la app nativa — no hace falta tocar nada ahi salvo que cambies el `channelId`/textos de la notificacion.

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
