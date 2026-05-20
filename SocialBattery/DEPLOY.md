# 🚀 Guía de Deploy — SocialBattery en Render.com

## Resumen rápido
- **Backend** → Render Web Service (Node.js) — gratis
- **Frontend** → Render Static Site (React) — gratis
- **Base de datos** → Supabase — ya configurada

---

## Paso 1 — Subir el código a GitHub

1. Ve a [github.com/new](https://github.com/new) y crea un repo privado llamado `socialbattery`
2. En tu terminal local, dentro de la carpeta del proyecto:

```bash
git init
git add .
git commit -m "SocialBattery — fase completa"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/socialbattery.git
git push -u origin main
```

---

## Paso 2 — Crear los servicios en Render

### Opción A — Blueprint automático (recomendado)

1. Ve a [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**
2. Conecta tu repo de GitHub
3. Render detectará el `render.yaml` y creará los 2 servicios automáticamente
4. Pasa al **Paso 3** para configurar las variables de entorno

### Opción B — Manual

**Backend:**
1. Render → New → Web Service
2. Conecta el repo → **Root Directory**: `server`
3. Runtime: `Node` | Build: `npm install` | Start: `npm start`

**Frontend:**
1. Render → New → Static Site
2. Conecta el repo → **Root Directory**: `client`
3. Build: `npm install && npm run build` | Publish: `./dist`
4. Añade rewrite rule: `/*` → `/index.html`

---

## Paso 3 — Variables de entorno

### 🔴 IMPORTANTE: orden de configuración

Tienes que hacer esto en orden porque la URL del server es necesaria para el cliente.

### 3.1 — Configura el BACKEND primero

En Render → `socialbattery-server` → **Environment**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://pmjaffcrtjrvjzomjdoj.supabase.co` |
| `SUPABASE_SERVICE_KEY` | (tu service_role key) |
| `SUPABASE_ANON_KEY` | (tu anon key) |
| `CLIENT_URL` | (déjalo vacío de momento) |
| `NODE_ENV` | `production` |

Guarda → espera a que el deploy termine (2-3 min).

Una vez desplegado, copia la URL del server. Será algo como:
```
https://socialbattery-server.onrender.com
```

### 3.2 — Configura el FRONTEND

En Render → `socialbattery-client` → **Environment**:

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://pmjaffcrtjrvjzomjdoj.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (tu anon key) |
| `VITE_API_URL` | `https://socialbattery-server.onrender.com/api` |

Guarda → el frontend se recompila automáticamente (2-3 min).

Una vez listo, copia la URL del cliente. Será algo como:
```
https://socialbattery-client.onrender.com
```

### 3.3 — Actualiza CLIENT_URL en el backend

Vuelve a `socialbattery-server` → Environment → actualiza:

| Variable | Valor |
|---|---|
| `CLIENT_URL` | `https://socialbattery-client.onrender.com` |

Render hará un redeploy automático. ¡Ya está!

---

## Paso 4 — Configurar Supabase para producción

### Allowed URLs (para Auth)

En Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://socialbattery-client.onrender.com`
- **Redirect URLs** (añadir):
  - `https://socialbattery-client.onrender.com/**`
  - `http://localhost:5173/**` (para seguir probando en local)

---

## Verificar que todo funciona

1. Abre `https://socialbattery-client.onrender.com`
2. Regístrate con un email real
3. Confirma el email (revisa spam)
4. Accede y actualiza la batería

Si algo falla, revisa **Logs** en el dashboard de Render de cada servicio.

---

## ⚠️ Nota sobre el free tier de Render

Los servicios gratuitos de Render **se duermen** tras 15 minutos de inactividad.
La primera petición tras el sleep tarda ~30 segundos (cold start).

Para evitarlo en el futuro puedes usar [UptimeRobot](https://uptimerobot.com) gratis
para hacer ping al endpoint `/api/health` cada 10 minutos y mantenerlo despierto.

URL a monitorizar: `https://socialbattery-server.onrender.com/api/health`

