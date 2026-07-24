# SocialBattery — Inventario de secretos y guardián maestro

Documento vivo. Contiene **QUÉ** secretos usa la app, **DÓNDE** están
configurados y **CÓMO** rotarlos. **NO** contiene los valores. Los valores
viven en:

1. Un gestor de contraseñas (Bitwarden / 1Password) — fuente de verdad
   personal, con backup offline (exportar a fichero cifrado con GPG cada
   pocos meses y guardarlo en un pendrive físico).
2. Los paneles de cada proveedor (Supabase, Koyeb/Railway, Google Cloud,
   Resend) — fuente de verdad "operativa".

Regla: si un valor está solo en un sitio, ese sitio es un punto único de
fallo. Cada secreto debe estar en (1) **y** en el panel del proveedor.

## Reglas de oro

- Nunca commitear `.env` — verificar que están en `.gitignore` **antes** de
  cada `git add` de cambios grandes en config.
- No pegar claves en chats de IA (incluido este), issues públicos, capturas
  de pantalla ni logs. Si se filtra una, se **rota** (no se "cambia por si
  acaso" — se genera una nueva y se invalida la anterior).
- Nada de fallbacks hardcodeados: si falta la env var, que el servidor
  **falle en el arranque**. Ver `server/index.js` (DEBUG_SECRET) o
  `server/lib/supabase.js`.
- Cada secreto tiene un **owner** (yo, siempre) y una **fecha de última
  rotación** (rellenar más abajo).
- Rotar cualquier secreto que haya podido tocar cualquiera que no sea el
  owner (colaborador puntual, ordenador prestado, etc).

## Inventario

### 🔒 Secretos del BACKEND (`server/.env` en local, panel del hosting en prod)

| Var | Qué es | De dónde viene | Rotación | Última rotación |
|---|---|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase | Panel Supabase → Settings → API | No aplica (es un identificador, no un secreto). | — |
| `SUPABASE_SERVICE_KEY` | **Clave con permisos de admin, se salta RLS.** El agujero más grave si se filtra. Solo en servidor. | Panel Supabase → Settings → API → `service_role` | Panel Supabase → Settings → API → "Reset service_role JWT". Redespliega el backend con la nueva. | ⚠️ pendiente inicial |
| `SUPABASE_ANON_KEY` | Clave pública que también usa el servidor para validar JWTs entrantes (en `middleware/auth.js`). No es "secreta" per se — se distribuye igual en el bundle del cliente — pero conviene rotarla si la de servicio se rota. | Panel Supabase → Settings → API → `anon` | Panel Supabase → Settings → API → "Reset anon JWT". Actualizar backend y frontend a la vez. | ⚠️ pendiente inicial |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Firma de las notificaciones web push. Si se rotan, **todas las suscripciones existentes se invalidan** y los usuarios tienen que volver a aceptar las notificaciones. | Generar con `node -e "console.log(require('web-push').generateVAPIDKeys())"` | Rotación cara (pierdes suscriptores). Solo rotar si se filtran. | — |
| `CLIENT_URL` | Lista separada por comas de orígenes permitidos por CORS. No es un secreto pero un valor incorrecto rompe el login (ver comentario extenso en `server/index.js`). | Manual | Cambia si añades/quitas dominios. | — |
| `DEBUG_SECRET` | Header `x-debug-secret` para los endpoints `/api/debug/*` (disparar jobs de recordatorio, inspeccionar el tope diario de notifs). **Si no está definida, los endpoints devuelven 401 siempre** (ya no hay fallback hardcodeado). | Generar con `openssl rand -hex 32` | Rotar si se comparte con alguien y ya no colabora. | ⚠️ pendiente inicial |
| `PORT` | Puerto del backend. | Lo pone el hosting. | — | — |

### 🌐 Secretos del FRONTEND (`client/.env` en local, panel del hosting en prod)

Todas las `VITE_*` **se empaquetan en el bundle público** — trátalas como
"conocidas por el mundo". Nunca poner ahí un secreto real.

| Var | Qué es | Notas |
|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase | Pública. |
| `VITE_SUPABASE_ANON_KEY` | Anon key (la misma que el servidor usa en `middleware/auth.js`, pero aquí es OK porque es pública por diseño y está protegida por las políticas RLS de la BD). | Pública, protegida por RLS. |
| `VITE_API_URL` | URL del backend | Pública. |
| `VITE_VAPID_PUBLIC_KEY` | Debe coincidir con `VAPID_PUBLIC_KEY` del servidor. | Pública. |

### 🏢 Cuentas de proveedores (login del panel)

No son "env vars" pero son igual de críticos: la contraseña maestra +
2FA de cada uno de estos es lo que da acceso a poder rotar todo lo demás.

| Proveedor | Qué controla | 2FA obligatorio |
|---|---|---|
| Supabase | Base de datos, auth, storage (avatares, chat, previews de mascota, ads, portadas), realtime | ✅ TOTP |
| Koyeb / Railway | Hosting del backend, cron jobs | ✅ TOTP |
| Render / Vercel (o donde esté el frontend) | Hosting SPA + dominio | ✅ TOTP |
| Registrador del dominio (`socialbattery.pro`) | Sin esto, se pierde el dominio entero | ✅ TOTP + candado de transferencia |
| Cuenta de Google (Cloud Console) | OAuth Google + Play Console (futuro) | ✅ TOTP + llave física |
| Resend | Envío de emails de login | ✅ TOTP |
| GitHub / GitLab | Código fuente | ✅ TOTP + firma de commits (opcional) |
| App Store Connect (futuro) | Publicación en App Store | ✅ TOTP |
| Google Play Console (futuro) | Publicación en Play Store | ✅ TOTP |

## Rotación coordinada — orden importante

Cuando se rota un secreto, hay que hacerlo por pasos, o el usuario ve la app
caída durante minutos.

**Supabase `service_role`**:
1. Genera la nueva clave en el panel.
2. Guárdala en el gestor de contraseñas.
3. Actualízala en el panel del hosting del backend (Koyeb/Railway).
4. El nuevo despliegue arranca; verifica que responde `GET /api/health`.
5. En Supabase, invalida la anterior (hasta este paso, ambas conviven).

**Supabase `anon`**:
1. Genera y guarda.
2. Actualízala **en frontend y backend a la vez**.
3. Redespliega ambos.
4. Invalida la anterior en Supabase.

**VAPID**:
1. Genera un par nuevo.
2. Guárdalo.
3. Actualiza servidor y cliente.
4. Redespliega ambos.
5. Al día siguiente, todos los suscriptores existentes fallarán con 410/404
   al enviarles push — el propio limpiador de suscripciones (fase 71 push
   subscription cleanup) las purgará. Los usuarios tendrán que
   re-suscribirse desde ajustes.

## Verificación de "salud" (haz esto cada tanto)

```bash
# 1. No hay .env commiteado por accidente
git ls-files | grep -E "^\.env$|/\.env$"   # debe estar vacío

# 2. Ningún secreto en el bundle público (mirando dist/)
cd client && npm run build && \
  grep -rE "eyJ[A-Za-z0-9_-]{40,}" dist/ | grep -v anon   # solo debería salir la anon key

# 3. .gitignore protege los .env
grep -E "^\.env" .gitignore server/.gitignore client/.gitignore 2>/dev/null
```

## Registro de rotaciones

_(Rellenar cada vez que se rote algo. Ayuda muchísimo cuando algo empieza
a fallar y no sabes desde cuándo.)_

| Fecha | Qué | Motivo |
|---|---|---|
| YYYY-MM-DD | | |

## Dependencias con vulnerabilidades conocidas pendientes

Se ha ejecutado `npm audit fix` en cliente y servidor:

- **Servidor**: 0 vulnerabilidades. `node-cron` subido a `4.6.0` (compat.
  verificada con la API que usa `server/index.js`, `cron.schedule(cronExpr, fn)`
  sigue funcionando igual), `body-parser` parcheado.
- **Cliente**: 2 avisos moderados en `react-router` pendientes de que se
  actualice a v7 (breaking). Los dos avisos son:
  - **SSR hydration / deserializeErrors** — no aplica: SocialBattery es una
    SPA pura (Vite + `createRoot`), no usa SSR.
  - **Open redirect vía backslash en `<Link>`/`useNavigate`** — no explotable
    en la práctica en esta app porque ningún destino de navegación proviene
    de input externo del usuario. Aun así, planificar migración a react-router
    v7 (o al equivalente de la app cuando se convierta a nativa) antes de
    exponer nuevas superficies donde la URL de destino pueda venir de fuera
    (p. ej. deep links de terceros).
