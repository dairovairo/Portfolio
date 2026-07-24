# Emails de login que llegan a spam — cómo arreglarlo

**Síntoma:** el email de confirmación / recuperación de contraseña llega a
la carpeta de Spam/No deseado en Gmail, Outlook o Yahoo.

**Causa:** el dominio remitente (`socialbattery.pro`) no tiene una política
DMARC publicada. SPF y DKIM ya los tienes vía Resend, pero **DMARC es el
que ata SPF+DKIM al dominio visible** y sin él los proveedores
grandes bajan mucho la reputación por defecto.

## 1. Añade el registro DMARC

En tu registrador de DNS (donde tengas `socialbattery.pro`), añade:

**Tipo:** TXT
**Nombre / Host:** `_dmarc` (subdominio)
**Valor:**
```
v=DMARC1; p=none; rua=mailto:dmarc@socialbattery.pro; ruf=mailto:dmarc@socialbattery.pro; fo=1; adkim=r; aspf=r
```

Qué significa cada trozo:
- `p=none` → política "solo observa, no rechaces" — empezamos así para no
  bloquear correo legítimo por accidente. Cuando lleves 2-4 semanas viendo
  reports limpios, subes a `p=quarantine` y después a `p=reject`.
- `rua=...` → dónde recibes los reports agregados diarios (JSON/XML) de
  cada proveedor grande. Configura una redirección de `dmarc@socialbattery.pro`
  a tu email personal, o al menos crea el alias.
- `ruf=...` → reports forenses (por mensaje fallido). Muchos proveedores
  ya no los envían, pero no molesta pedirlos.
- `fo=1` → pide reports también si SPF o DKIM fallan por separado (no solo
  si fallan ambos).
- `adkim=r` / `aspf=r` → alineamiento "relajado" (permite subdominios).
  Deja esto tal cual salvo que sepas exactamente qué haces.

## 2. Verifica SPF y DKIM

Deberías tenerlos ya de la configuración de Resend, pero comprueba con:

```bash
dig +short TXT socialbattery.pro     # SPF: debe salir "v=spf1 include:_spf.resend.com ~all" o similar
dig +short TXT resend._domainkey.socialbattery.pro   # DKIM: debe salir "v=DKIM1;..."
dig +short TXT _dmarc.socialbattery.pro              # DMARC: debe salir el registro que acabas de poner
```

Si alguno falta o sale vacío, revísalo en el panel de Resend (Domains → tu
dominio) — hay que copiar los registros que te da y pegarlos en el DNS.

## 3. Ajusta el "From:" en Supabase

En Supabase → Authentication → Emails, asegúrate de que:

- **From email**: usa un email `@socialbattery.pro` (no `@gmail.com` ni el
  subdominio de Supabase). Si el From no coincide con el dominio del DKIM,
  DMARC falla.
- **From name**: "SocialBattery" (o similar), sin caracteres raros.
- **Reply-to**: uno de tu dominio, no dejarlo por defecto.

## 4. Prueba y mide la puntuación

Envía un email de recuperación a estas direcciones (una a una, o crear
cuentas de prueba en cada proveedor):

- Un buzón en `mail-tester.com` (te da una nueva URL con puntuación
  sobre 10; objetivo: 9+).
- Una cuenta de Gmail.
- Una cuenta de Outlook / Hotmail.
- Una cuenta de Yahoo si tu público la usa.

En Gmail: abre el mensaje → clic en los tres puntos → "Mostrar original".
Busca:
- `SPF: PASS` ✅
- `DKIM: PASS` ✅
- `DMARC: PASS` ✅

Si alguno da `NEUTRAL` o `FAIL`, no lo despliegas hasta arreglarlo — el
primer email que reciben los usuarios en su vida es el de confirmación, y
si va a spam, se pierden la mitad.

## 5. Sube la política progresivamente

Después de 2-4 semanas de monitorear los reports `rua`:

- Si no ves rebotes ni envíos legítimos fallando por alineamiento →
  cambia a `p=quarantine; pct=25` (mete el 25% del correo dudoso en
  spam) durante 2 semanas más.
- Después → `p=quarantine; pct=100`.
- Y finalmente → `p=reject`. Este es el estado "ideal" para producción:
  cualquier email que suplante tu dominio no le llega a nadie.

## 6. Retoques opcionales pero recomendados

- **BIMI**: si registras el logo con Verified Mark Certificate,
  Gmail muestra tu icono junto al remitente. Marketing puro pero mejora
  mucho la confianza. Coste: 1-2k€/año para el certificado. Deja para más
  adelante.
- **List-Unsubscribe**: si algún día envías emails no transaccionales
  (newsletters, resúmenes semanales), añade `List-Unsubscribe` en la
  cabecera. Los emails de login/reset no lo necesitan.
- **Warm-up de dominio**: si mañana pasas de 0 emails/día a 5000, los
  proveedores te tratarán como sospechoso. Cuando llegue el momento del
  lanzamiento grande, empieza con volumen moderado (unos cientos/día) y
  ve subiendo semana a semana.
