# SocialBattery Desktop

Este directorio genera una app de escritorio para Windows usando Electron.

La app no empaqueta el backend ni Supabase. Abre la URL publica de Render, asi que tus amigos usaran la misma aplicacion real que ya tienes desplegada.

## 1. Configurar la URL

Ejecuta:

```powershell
cd "C:\Users\hp\Portfolio\SocialBattery\sb_koyeb\desktop"
npm.cmd run set-url -- https://tu-app.onrender.com
```

Usa la URL real de tu frontend en Render, por ejemplo:

```powershell
npm.cmd run set-url -- https://socialbattery-client.onrender.com
```

## 2. Instalar dependencias

```powershell
cd "C:\Users\hp\Portfolio\SocialBattery\sb_koyeb\desktop"
npm.cmd install
```

## 3. Probar en modo escritorio

```powershell
npm.cmd start
```

## 4. Generar ejecutable

```powershell
npm.cmd run dist
```

Antes de construir, el script comprueba que la URL responde correctamente. Si aparece `Not Found`, casi siempre significa que configuraste una URL de ejemplo o una URL que no es la del frontend de Render.

Los archivos saldran en:

```text
C:\Users\hp\Portfolio\SocialBattery\sb_koyeb\desktop\dist
```

Para mandar a un amigo, usa preferiblemente el instalador `SocialBattery Setup ... .exe`.
El `portable.exe` tambien sirve para pruebas rapidas.

## Nota sobre Windows

El ejecutable no esta firmado con certificado comercial, asi que Windows SmartScreen puede mostrar un aviso la primera vez. Para una prueba privada es normal; para publicarlo en serio haria falta firmarlo.
