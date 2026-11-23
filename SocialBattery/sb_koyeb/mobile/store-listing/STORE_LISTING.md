# Ficha de Google Play: SocialBattery

Todo lo que pide Play Console para publicar, listo para copiar y pegar. Los gráficos
están en esta misma carpeta y se regeneran con:

```
node store-listing/make-graphics.js
```

| Recurso | Fichero | Requisito de Play |
|---|---|---|
| Icono de la app | `icon-512.png` | 512×512 PNG |
| Gráfico destacado | `feature-graphic-1024x500.png` | 1024×500, sin transparencia |
| Capturas de teléfono | **Hazlas tú** (ver abajo) | Mínimo 2, recomendable entre 4 y 8; proporción máxima 2:1 |

**Capturas.** Inicia sesión en la app (móvil o emulador) y captura estas pantallas:

- Inicio con tu batería social
- Comunidades
- Un evento
- Un chat
- La mascota/tienda

Usa una cuenta de prueba, sin datos personales reales de nadie. Si el móvil hace
capturas más alargadas que 2:1 (por ejemplo, 1080×2400), recórtalas a 1080×2160.

---

## Detalles de la app

- **Nombre** (máx. 30): `SocialBattery`
- **Categoría:** Social
- **Etiquetas:** Social, Eventos, Comunidades
- **Email de contacto:** el tuyo de soporte (Play lo muestra públicamente)
- **Web:** https://socialbattery.pro
- **Política de privacidad:** https://socialbattery.pro/privacidad

### Descripción breve (máx. 80)

ES:
> Comparte tu batería social, queda con amigos y descubre eventos y comunidades.

EN:
> Share your social battery, meet friends and discover events and communities.

### Descripción completa (máx. 4000)

ES:

> ¿Hoy te apetece todo o necesitas estar solo? Con SocialBattery compartes tu
> **batería social**, desde 0 % (modo cueva) hasta 100 % (con ganas de todo), y tus
> amigos saben al momento si es buen día para proponerte un plan.
>
> **Qué puedes hacer**
> ⚡ Indicar tu nivel de energía social y decidir con quién compartirlo
> 💬 Chatear en privado, en grupos o en el chat de tu comunidad
> 📍 Apuntarte a quedadas ("pools") organizadas por otros usuarios cerca de ti
> 📅 Descubrir eventos y recibir recordatorios antes de que empiecen
> 👥 Unirte a comunidades con tus mismos intereses
> 🎁 Participar en sorteos organizados por tu comunidad
> 🏅 Ganar insignias y personalizar tu propia mascota
>
> **Para organizadores**
> Crea tu comunidad, publica eventos y sorteos, y promociónalos entre usuarios
> interesados de tu zona. Pagas solo por las notificaciones y visualizaciones que de
> verdad se entregan, y desde el panel de control ves el alcance y los clics de cada
> campaña.
>
> **Tu privacidad, primero**
> Tú decides quién ve tu batería y tu ubicación. Puedes bloquear y denunciar a otros
> usuarios, y borrar tu cuenta con todos tus datos desde Ajustes cuando quieras.

EN:

> Up for anything today, or need some alone time? With SocialBattery you share your
> **social battery**, from 0% (cave mode) to 100% (up for anything), so your friends
> know at a glance whether it's a good day to make plans.
>
> **What you can do**
> ⚡ Set your social energy level and choose who sees it
> 💬 Chat privately, in groups or in your community chat
> 📍 Join hangouts ("pools") organized by people near you
> 📅 Discover events and get reminders before they start
> 👥 Join communities that share your interests
> 🎁 Take part in giveaways run by your community
> 🏅 Earn badges and customize your own mascot
>
> **For organizers**
> Create your community, publish events and giveaways, and promote them to interested
> users nearby. You only pay for the notifications and views actually delivered, and
> the dashboard shows each campaign's reach and clicks.
>
> **Privacy first**
> You choose who sees your battery and location. Block and report other users, and
> delete your account and all its data from Settings at any time.

---

## Contenido de la app (cuestionarios de Play Console)

### Acceso a la app

La app requiere iniciar sesión. Facilita a Google una **cuenta de prueba** con email y
contraseña (no la tuya personal) y explica:

> Inicia sesión con email y contraseña en la pantalla de acceso.

### Anuncios

**No** contiene anuncios de terceros (SDK publicitarios). Las promociones de eventos
y sorteos son contenido propio de la app, no una red publicitaria.

### Clasificación de contenido (cuestionario IARC)

- **Categoría:** Social / comunicación.
- **Interacción entre usuarios:** sí (chat, mensajes, contenido generado por usuarios).
- **Comparte la ubicación del usuario con otros usuarios:** sí (localizador de eventos,
  ubicación de quedadas).
- **Compras digitales:** sí.
- **Violencia, sexo, drogas, lenguaje soez:** no (más allá de lo que escriban los
  usuarios, que se puede denunciar).
- **Apuestas o simulación de apuestas:** no. Ver la nota sobre los sorteos más abajo.

### Público objetivo

Mayores de 18 años. Es lo más sencillo para una red social con chats entre
desconocidos, ubicación y pagos. Marca que **no** está dirigida a niños.

### Seguridad de los datos

- ¿Recoge o comparte datos? **Sí, los recoge.** **No** se venden ni se comparten con
  terceros para sus propios fines.
- Los proveedores que procesan datos por cuenta de la app no cuentan como "compartir"
  en el formulario: Supabase, Railway, Firebase, Stripe y Google Play.
- ¿Cifrado en tránsito? **Sí** (HTTPS).
- ¿El usuario puede pedir que se borren sus datos? **Sí**, desde Ajustes → Eliminar
  cuenta. Añade también la URL https://socialbattery.pro/privacidad.

| Tipo de dato | ¿Se recoge? | Para qué | ¿Opcional? |
|---|---|---|---|
| Nombre | Sí | Funcionalidad, gestión de cuenta | No |
| Email | Sí | Gestión de cuenta | No |
| ID de usuario | Sí | Funcionalidad, gestión de cuenta | No |
| Ubicación aproximada | Sí | Funcionalidad (eventos y quedadas cerca) | Sí |
| Ubicación precisa | Sí | Funcionalidad (localizador en eventos) | Sí |
| Fotos | Sí | Funcionalidad (avatar, portadas, chat) | Sí |
| Mensajes in-app | Sí | Funcionalidad (chat) | No |
| Otro contenido de usuario | Sí | Funcionalidad (eventos, encuestas, denuncias) | Sí |
| Historial de compras | Sí | Funcionalidad (saldo, suscripciones) | Sí |
| Interacciones con la app | Sí | Analítica de campañas (clics, visualizaciones) | No |
| ID de dispositivo / push token | Sí | Funcionalidad (notificaciones) | Sí |

### Otros formularios

- **Aplicación gubernamental / financiera / salud:** no.
- **Noticias:** no.
- **Permisos sensibles:** notificaciones y ubicación (aproximada y precisa, solo con la
  app en uso). La app no pide ubicación en segundo plano.

---

## ⚠️ Antes de enviar a revisión: sorteos

Un sorteo en el que **para participar hay que pagar** puede considerarse juego, tanto
para Google Play como para la ley española. Es un riesgo que conviene confirmar (política
de Play y asesoría legal) antes de publicar. Ahora mismo:

- **Sorteo Volt:** solo participan los suscriptores de pago. Es pago para participar.
- **Sorteo Community:** solo participan quienes han hecho una "colaboración" económica
  con la comunidad. Es pago para participar.
- **Sorteo Light:** participan todos los miembros. Correcto.

Puede ser motivo de rechazo, o de retirada posterior de la app. Lo hablamos en la
revisión del sistema de sorteos. La opción más simple es que cualquier miembro pueda
participar gratis en todos (la suscripción solo daría, por ejemplo, alguna
participación extra) y publicar unas bases legales de cada sorteo.

---

## Lanzamiento

1. Crea la app en Play Console:
   - Nombre: SocialBattery.
   - Idioma por defecto: Español (España).
   - Tipo: App.
   - Precio: Gratis.
2. Sube `app-release.aab` (está en `mobile/android/app/build/outputs/bundle/release/`)
   a **Pruebas internas** y comprueba que instala.
3. Rellena todo lo de arriba (ficha y Contenido de la app).
4. **Cuentas personales creadas después del 13/11/2023:** antes de poder publicar en
   *Producción*, Google exige una **prueba cerrada con al menos 12 testers durante 14
   días seguidos**. No es opcional: sin ella, el botón de producción no aparece. La
   alternativa es una cuenta de organización (requiere D-U-N-S), que está exenta.
5. Cada vez que subas una versión nueva, sube `versionCode` en
   `mobile/android/app/build.gradle`. Luego:

   ```
   cd mobile
   npm run build:android:bundle
   ```

   El build firma el AAB con `android/keystore.properties`.
6. **Guarda bien** `C:\Users\hp\SocialBattery-firma\` (keystore + contraseña). Con Play
   App Signing, si se pierde se puede pedir a Google un reset de la clave de subida,
   pero es un trámite lento.
