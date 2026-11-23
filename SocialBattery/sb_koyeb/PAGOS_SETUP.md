# Pagos en SocialBattery: puesta en marcha

El código ya está hecho. Este documento recoge **lo que tienes que hacer tú** en
Supabase, Stripe, Google Play Console y Railway, en este orden. Hasta que
pongas `PAYMENTS_ENABLED=true` todo sigue funcionando gratis, como hasta ahora.

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
   o vence el sorteo, o se entrega todo lo contratado) se **liquida**. Se cobra solo lo
   entregado si se alcanzó el umbral de 200 unidades; si no, se cobra 0. El resto
   vuelve al saldo. Lo hace el cron `jobs/settleAdHolds.js` cada 10 minutos, y las
   rutas de finalizar y renovar lo hacen al momento.
3. El sorteo Community cuesta una tarifa fija de 5 € al crearlo.
4. El sorteo Volt es gratis.

El servidor **nunca** acredita nada por lo que diga la app. Cada pago se verifica con
Stripe o con la API de Google Play. Además, es idempotente: un webhook repetido no
acredita dos veces.

---

## 1. Supabase: migración

En el SQL Editor, ejecuta `supabase_schema_phase134_wallet_payments.sql`. Se puede
volver a ejecutar sin problemas.

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

Para probar en modo test, usa la tarjeta `4242 4242 4242 4242` con cualquier fecha
futura y cualquier CVC.

## 3. Google Play Console (cobros en la app)

1. **Perfil de pagos (merchant):** ve a Play Console → Configuración → Perfil de pagos.
   Sin él no se pueden crear productos de pago.
2. **Sube el AAB** (`mobile/android/app/build/outputs/bundle/release/app-release.aab`)
   a una pista de prueba interna. Play no deja crear productos hasta que haya un AAB
   con el permiso de facturación, y el AAB nuevo ya lo incluye.
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
GOOGLE_PLAY_PACKAGE_NAME=com.socialbattery.app
```

`PAYMENTS_ENABLED=true` es lo último que se activa: a partir de ese momento las
campañas Premium/Ultra/Light reservan saldo.

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

- **Colaboraciones P2P a comunidades.** El dinero va a otra persona, no a
  SocialBattery. Para hacerlo bien hace falta Stripe Connect, con verificación de
  identidad de cada administrador. Antes de cobrarlo dentro de la app hay que comprobar
  qué dice la política de pagos de Google Play sobre este caso (no está comprobado).
  De momento siguen registrándose sin cobro real, igual que antes.
- **Ventajas de las suscripciones.** Ya están conectadas: *participación en sorteos
  Volt* (`is_volt_subscriber`) y *150 Volts semanales*. Las demás ventajas que anuncia
  la tienda no se aplican todavía, porque no hay nada que bloquear sin suscripción:
  - "sin anuncios"
  - "modo localizador"
  - "creación de eventos y sorteos" para Enterprise

  Hay que decidir si se restringen esas funciones o se cambian los textos.
- **Reembolsos de Google Play.** Se gestionan desde Play Console. El saldo no se
  descuenta automáticamente; para eso haría falta la API de *voided purchases*. Los
  reembolsos de Stripe sí se descuentan solos.
