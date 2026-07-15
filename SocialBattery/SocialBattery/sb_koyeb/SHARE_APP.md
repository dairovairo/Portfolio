# Compartir SocialBattery

## En movil

No mandes el `.exe`. Un `.exe` solo funciona en Windows.

Manda la URL publica de Render:

```text
https://tu-app.onrender.com
```

Android:

1. Abrir el enlace en Chrome.
2. Menu de tres puntos.
3. Instalar app o Anadir a pantalla de inicio.

iPhone:

1. Abrir el enlace en Safari.
2. Boton compartir.
3. Anadir a pantalla de inicio.

## En Windows

Usa el instalador generado en:

```text
desktop\dist\SocialBattery Setup 1.0.0.exe
```

Antes de generar el instalador, configura la URL real:

```powershell
cd "C:\Users\hp\Portfolio\SocialBattery\sb_koyeb\desktop"
npm.cmd run set-url -- https://tu-app.onrender.com
npm.cmd run dist
```

## SmartScreen

Windows puede mostrar aviso porque la app no esta firmada con un certificado comercial.

Para quitar ese aviso de verdad necesitas una de estas opciones:

- Firmar el instalador con un certificado de codigo OV o EV.
- Publicar por Microsoft Store.
- Usar la version web/PWA para evitar enviar `.exe`.

Una firma propia o de prueba puede servir en tus propios ordenadores si instalas el certificado, pero no eliminara SmartScreen para amigos.
