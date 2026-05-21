# 🚀 Deploy — SocialBattery
# Backend: Koyeb (gratis) · Frontend: Render Static Site (gratis)

---

## Paso 1 — Subir el código a GitHub

```bash
git init
git add .
git commit -m "SocialBattery"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/socialbattery.git
git push -u origin main
```

---

## Paso 2 — Backend en Koyeb

1. Ve a **koyeb.com** → regístrate (no pide tarjeta)
2. **Create Service** → **GitHub**
3. Selecciona tu repo `socialbattery`
4. Configura:
   - **Branch**: `main`
   - **Build and deployment settings**:
     - Root directory: `server`
     - Build command: `npm install`
     - Run command: `npm start`
   - **Port**: `8000` (Koyeb lo gestiona, pero asegúrate de que esté en 8000)
5. En **Environment variables** añade:
   - `SUPABASE_URL` → `https://pmjaffcrtjrvjzomjdoj.supabase.co`
   - `SUPABASE_SERVICE_KEY` → tu service_role key
   - `SUPABASE_ANON_KEY` → tu anon key
   - `CLIENT_URL` → (déjalo vacío por ahora)
   - `NODE_ENV` → `production`
6. **Deploy** → espera 2-3 min → cuando esté verde copia la URL:
   `https://TU-APP.koyeb.app`

---

## Paso 3 — Frontend en Render

1. Ve a **render.com** → **New → Static Site**
2. Conecta el repo de GitHub
3. Configura:
   - **Root Directory**: `client`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. En **Environment Variables** añade:
   - `VITE_SUPABASE_URL` → `https://pmjaffcrtjrvjzomjdoj.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` → tu anon key
   - `VITE_API_URL` → `https://TU-APP.koyeb.app/api`
5. En **Redirects/Rewrites** añade una regla:
   - Source: `/*` → Destination: `/index.html` → Action: `Rewrite`
6. **Create Static Site** → espera 2-3 min → copia la URL:
   `https://socialbattery-client.onrender.com`

---

## Paso 4 — Conectar los dos servicios

### 4.1 — Actualiza CLIENT_URL en Koyeb

Koyeb → tu servicio → **Settings → Environment variables**:
- `CLIENT_URL` → `https://socialbattery-client.onrender.com`

Guarda → hace redeploy automático.

### 4.2 — Configura Supabase para producción

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://socialbattery-client.onrender.com`
- **Redirect URLs** (añadir las dos):
  - `https://socialbattery-client.onrender.com/**`
  - `http://localhost:5173/**`

---

## Verificar que todo funciona

Abre `https://socialbattery-client.onrender.com` y comprueba:
- Puedes registrarte y recibir el email de confirmación
- El login funciona
- La batería se guarda y se muestra en el feed de amigos

Si algo falla:
- Revisa los logs en Koyeb → tu servicio → **Logs**
- Comprueba que `VITE_API_URL` acaba en `/api` (sin barra final)
- Comprueba que `CLIENT_URL` en Koyeb NO tiene barra final

---

## Para desarrollo local (igual que antes)

```bash
# server/.env
SUPABASE_URL=https://pmjaffcrtjrvjzomjdoj.supabase.co
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
PORT=3001
CLIENT_URL=http://localhost:5173

# client/.env
VITE_SUPABASE_URL=https://pmjaffcrtjrvjzomjdoj.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=http://localhost:3001/api
```
