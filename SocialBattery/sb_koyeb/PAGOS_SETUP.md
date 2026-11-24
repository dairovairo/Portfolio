# Pagos en SocialBattery: puesta en marcha

> **El lanzamiento es gratuito.** Ahora mismo no hay que hacer nada de Stripe ni de Google
> Play Billing. Lo único obligatorio de este documento son las migraciones de Supabase
> (sección 1). El resto es para cuando decidas cobrar.

## Lanzamiento gratuito: cómo está ahora

Los pagos están ocultos con dos interruptores, los dos apagados por defecto:

| Dónde | Variable | Qué hace apagada |
|---|---|---|
| Railway (servidor) | `PAYMENTS_ENABLED` | Nada se cobra y el servidor rechaza cualquier intento de pago |
| Render (web) | `VITE_PAYMENTS_ENABLED` | No se ve ningún precio, saldo, compra, suscripción ni aportación |

**No las pongas.** Si no existen, la app es gratis.

Límites de la versión gratuita, para que nadie acapare la publicidad:

| Límite | Valor | Dónde se cambia |
|---|---|---|
| Promociones por cuenta cada 30 días (las renovaciones cuentan) | 4 | `server/lib/freePromo.js` |
| Promociones en marcha a la vez por cuenta | 2 | `server/lib/freePromo.js` |
| Personas por promoción | 500 | `server/lib/freePromo.js` |
| Actividades activas por cuenta | 8 | `server/lib/entitlements.js` |
| Actividades activas por comunidad | 4 | `server/lib/entitlements.js` |

### Para empezar a cobrar más adelante

1. Habla antes con una gestoría (sección 5).
2. Haz las secciones 2, 3 y 4 de este documento.
3. Vuelve a meter las compras en la app Android. Para el lanzamiento se quitó el plugin, así
   que el AAB actual no pide el permiso de facturación:

   ```
   cd mobile
   npm i @capgo/native-purchases
   npx cap sync android
   npm run build:android:bundle
   ```

   Sube `versionCode` en `mobile/android/app/build.gradle` antes de compilar.
4. En Render, añade `VITE_PAYMENTS_ENABLED=true` y vuelve a desplegar. En Railway, añade
   `PAYMENTS_ENABLED=true`. Haz las dos cosas a la vez.
5. Actualiza en Play Console lo que cambió para el lanzamiento gratuito: compras digitales
   (sí), historial de compras en Seguridad de los datos, los proveedores Stripe y Google Play,
   y la descripción para organizadores.

---

El código de los pagos ya está hecho. Lo que sigue recoge **lo que tienes que hacer tú** en
Supabase, Stripe, Google Play Console y Railway, en este orden.

## Cómo funciona

| Qué se vende | Web | App Android | Dónde se guarda |
|---|---|---|---|
| Saldo publicitario: packs de 10/25/50/100/250 € | Stripe Checkout | Google Play Billing | `wallets` y `wallet_transactions` |
| Packs de Volts (200/500/2000/5000) | Stripe Checkout | Google Play Billing | `user_volts` |
| Suscripción Volt (1,99 €/mes) y Enterprise (4,99 €/mes) | Stripe (suscripción) | Play (suscripción) | `subscriptions`, que actualiza `users.is_volt_subscriber` y `users.is_enterprise` |

**Saldo prepago:**
1. Al lanzar una campaña (evento Premium/Ultra o sorteo Light) se **reserva** el importe
   máximo: unidades contratadas × precio unitario. Si no hay saldo suficiente, la API
   responde 402 y la app ofrece recargar.
2. Al terminar la campaña (la finalizas tú, la renuevas, empieza el evento, se sortea
   o vence el sorteo, se cancela, o se entrega todo lo contratado) se **liquida**. Se
   cobra solo lo entregado y el resto vuelve al saldo. Lo hace el cron
   `jobs/settleAdHolds.js` cada 10 minutos, y las rutas de finalizar, renovar y cancelar
   lo hacen al momento.
3. **Las 50 primeras entregas de cada campaña son gratis** (y en Ultra, también los 50
   primeros banners). No hay mínimo de cobro.

**Precios** (`server/lib/adPricing.js` y `server/lib/billingCatalog.js`):

| Qué | Precio |
|---|---|
| Evento Premium | 2 cts por notificación entregada |
| Evento Ultra | 2 cts por notificación + 1 ct por banner visto |
| Sorteo Light | 2 cts por banner visto |
| Sorteo Community | 10 € fijos al crearlo, y requiere Enterprise |
| Sorteo Volt | Gratis; la comunidad necesita 10 miembros con suscripción Volt |

**Aportaciones a comunidades:** van directas a la cuenta de Stripe del creador (Stripe
Connect), sin comisión y sin dar ventaja en los sorteos. Requieren Enterprise.

El servidor **nunca** acredita nada por lo que diga la app. Cada pago se verifica con
Stripe o con la API de Google Play. Además, es idempotente: un webhook repetido no
acredita dos veces.

---

## 1. Supabase: migraciones

En el SQL Editor, ejecuta **en este orden y antes de desplegar el código**:

1. `supabase_schema_phase134_wallet_payments.sql`
2. `supabase_schema_phase135_ads_raffles_overhaul.sql`
3. `supabase_schema_phase136_free_launch.sql`

Las tres se pueden volver a ejecutar sin problemas.

## 2. Stripe (cobros en la web)

1. Crea la cuenta en https://dashboard.stripe.com. Para cobrar en real tendrás que
   activarla con tus datos fiscales y una cuenta bancaria; mientras tanto, prueba en
   modo test.
2. Ve a **Developers → API keys** y copia la *Secret key* (`sk_test_…` o `sk_live_…`).
   Esa es la variable `STRIPE_SECRET_KEY`.
3. Ve a **Developers → Webhooks → Add endpoint**:
   - URL: `https://portfolio-production-37ba.up.railway.app/api/payments/stripe/webhook`
   - Eventos:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `charge.refunded`
   - Copia el *Signing secret* (`whsec_…`). Esa es la variable `STRIPE_WEBHOOK_SECRET`.
4. Ve a **Settings → Billing → Customer portal** y actívalo. Es la pantalla de
   "Gestionar suscripción".
5. No hace falta crear productos en Stripe: el servidor los genera al vuelo con el
   precio del catálogo (`server/lib/billingCatalog.js`).

6. **Stripe Connect** (aportaciones a comunidades):
   1. Ve a **Connect** y actívalo, con cuentas de tipo *Standard*. Stripe te pedirá
      rellenar el perfil de la plataforma.
   2. En **Developers → Webhooks**, añade un **segundo** endpoint con la misma URL, pero
      marcando que escuche los eventos de las **cuentas conectadas**:
      - `checkout.session.completed`
      - `checkout.session.async_payment_succeeded`
      - `charge.refunded`
      - `account.updated`
      - `account.application.deauthorized`
   3. Su *Signing secret* es la variable `STRIPE_CONNECT_WEBHOOK_SECRET`.

   Cada creador conecta su cuenta desde **Saldo → Recibir aportaciones**.

Para probar en modo test, usa la tarjeta `4242 4242 4242 4242` con cualquier fecha
futura y cualquier CVC.

## 3. Google Play Console (cobros en la app)

1. **Perfil de pagos (merchant):** ve a Play Console → Configuración → Perfil de pagos.
   Sin él no se pueden crear productos de pago.
2. **Sube el AAB** (`mobile/android/app/build/outputs/bundle/release/app-release.aab`)
   a una pista de prueba interna. Play no deja crear productos hasta que haya un AAB
   con el permiso de facturación. El AAB del lanzamiento gratuito **no** lo lleva: antes
   reinstala el plugin de compras (ver "Para empezar a cobrar más adelante").
3. **Productos únicos** (Monetizar → Productos → Productos de compra única). Créalos
   con **exactamente** estos IDs:

   | ID | Precio sugerido |
   |---|---|
   | `wallet_10` | 10,00 € |
   | `wallet_25` | 25,00 € |
   | `wallet_50` | 50,00 € |
   | `wallet_100` | 100,00 € |
   | `wallet_250` | 250,00 € |
   | `volts_200` | 0,99 € |
   | `volts_500` | 1,99 € |
   | `volts_2000` | 4,99 € |
   | `volts_5000` | 9,99 € |

   El saldo que se acredita siempre es el del catálogo: `wallet_10` da 10 € de saldo
   aunque en otro país Play lo venda a otro precio.
4. **Suscripciones** (Monetizar → Suscripciones):
   - `sub_volt`: base plan con ID **`monthly`**, renovación automática mensual, 1,99 €.
   - `sub_enterprise`: base plan con ID **`monthly`**, 4,99 €.
5. **Cuenta de servicio para verificar compras:**
   1. En Google Cloud, en el proyecto de Firebase, habilita la **Google Play Android
      Developer API**.
   2. En Play Console → Usuarios y permisos → Invitar usuario, mete el email de la
      cuenta de servicio de Firebase (`FIREBASE_CLIENT_EMAIL`).
   3. Dale los permisos **Ver datos financieros** y **Gestionar pedidos y
      suscripciones**.
   4. Si quieres usar una cuenta distinta, define `GOOGLE_PLAY_CLIENT_EMAIL` y
      `GOOGLE_PLAY_PRIVATE_KEY`.
   - Los permisos pueden tardar hasta 24 h en propagarse. Hasta entonces la
     verificación da 401/403.
6. **Testers de licencia** (Configuración → Pruebas de licencias): añade tu cuenta de
   Google para comprar sin que te cobren de verdad.

## 4. Railway: variables de entorno

Añade estas variables:

```
PAYMENTS_ENABLED=true
PUBLIC_APP_URL=https://socialbattery.pro
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
GOOGLE_PLAY_PACKAGE_NAME=com.socialbattery.app
```

`PAYMENTS_ENABLED=true` es lo último que se activa: a partir de ese momento las
campañas Premium/Ultra/Light reservan saldo, el sorteo Community cuesta 10 € y se aplican
las ventajas de Volt y Enterprise. Mientras esté apagado, todo es gratis para todos.

## 5. Impuestos y comisiones

- **Comisiones:**
  - Google se queda un 15 % de lo que se compra en la app (primer millón al año).
  - Stripe cobra aproximadamente 1,5 % + 0,25 € por tarjeta europea.
- **IVA:**
  - Google Play declara e ingresa el IVA de las compras hechas en la app.
  - En la web lo declaras tú. Puedes activar Stripe Tax o incluirlo en el precio;
    los textos dicen "IVA incluido".
- **Fiscalidad:** cobrar de forma habitual implica darse de alta como autónomo (o
  sociedad) y facturar. Consulta con una gestoría antes de activar el modo *live*.

## Pendiente o fuera de alcance

- **Aportaciones dentro de la app Android.** Se pagan con Stripe en el navegador, porque
  el dinero va a otra persona y SocialBattery no cobra nada. Antes de activarlo, comprueba
  que encaja con la política de pagos de Google Play (no está confirmado). Si no encajara,
  se puede dejar solo en la web.
- **Papeletas ×3 de Volt.** Participar es gratis para todos, pero una suscripción de pago
  da más papeletas. Es el punto más delicado de los sorteos: confírmalo con un abogado.
  Para quitarlo, pon `VOLT_TICKETS = 1` en `server/lib/raffles.js` y en
  `client/src/lib/raffleTiers.js`, y cambia los textos que lo mencionan.
- **Reembolsos de Google Play.** Se gestionan desde Play Console. El saldo no se
  descuenta automáticamente; para eso haría falta la API de *voided purchases*. Los
  reembolsos de Stripe sí se descuentan solos.
