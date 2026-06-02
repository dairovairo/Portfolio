# ✨ SocialBattery — Fase 8: Pulido & UX

## Resumen de cambios

Esta fase cierra el ciclo de desarrollo convirtiendo SocialBattery en una PWA
completa, con soporte de tema claro/oscuro, onboarding multi-paso, perfil de
usuario enriquecido, navegación mobile-first y notificaciones push.

---

## Backend (`/server`)

### `routes/users.js` — Actualizado
- **`POST /api/users/avatar`** — Subida de avatar con `multer` (memoria).
  Sube a Supabase Storage (`avatars/`). Fallback a data URL si no hay bucket.
- **`POST /api/users/push-subscribe`** — Almacena endpoint de notificaciones push
  del usuario en la tabla `push_subscriptions`.
- **`PATCH /api/users/me`** — Acepta campo `bio` (máx. 160 chars).
- **`GET /api/users/:id`** — Devuelve campo `bio` en el perfil público.
- **`GET /api/users/search`** — Devuelve campo `bio`.

### `routes/auth.js` — Actualizado
- **`POST /api/auth/profile`** — Acepta `display_name`, `bio`, `initial_battery`
  al crear el perfil durante el onboarding. Registra la batería inicial en
  `battery_history`.

### `index.js` — Actualizado
- Rate limiter separado para uploads (`/api/users/avatar`): 20 req / 15 min.
- Header `crossOriginResourcePolicy: cross-origin` para permitir carga de imágenes.
- Versión bumped a `1.8.0 / phase: 8`.

### `package.json`
- Nueva dependencia: `multer ^1.4.5-lts.1` para multipart file upload.

---

## Frontend (`/client`)

### `context/ThemeContext.jsx` — Nuevo
- Persiste tema en `localStorage`.
- Lee `prefers-color-scheme` del sistema como valor por defecto.
- Escribe `data-theme` en `<html>` → activa las CSS variables de cada tema.
- Actualiza la `<meta name="theme-color">` para PWA.

### `context/ToastContext.jsx` — Nuevo
- Sistema de toasts global con tipos: `success`, `error`, `warning`, `info`.
- Auto-dismiss configurable (default 3500 ms).
- Rendered fuera del árbol de rutas; no bloquea navegación.
- Animación `animate-slide-up` por cada nuevo toast.

### `hooks/usePush.js` — Nuevo
- Gestiona el ciclo `Notification.requestPermission → PushManager.subscribe`.
- Envía la suscripción al backend (`POST /api/users/push-subscribe`).
- `usePush()` expone: `{ permission, subscribed, requestPermission }`.

### `components/BottomNav.jsx` — Nuevo
- Barra de navegación inferior fija, visible en todas las páginas principales.
- Iconos + labels + badges de notificación para Amigos y Mensajes.
- Resaltado de ruta activa (color + scale).
- `padding-bottom: env(safe-area-inset-bottom)` para iPhone X+.

### `index.css` — Reescrito
- **Variables CSS por tema**: `--sb-bg`, `--sb-card`, `--sb-border`, etc.
  cambian según `[data-theme="dark|light"]`.
- Clases `.bg-surface-*` y `.border-surface-border` usan `var(--sb-*)`.
- Nuevas animaciones: `slideDown`, `scaleIn`.
- Clase `.skeleton` para loading placeholders con shimmer animado.
- `.pb-safe` / `.pt-safe` para safe areas en PWA.

### `tailwind.config.js` — Actualizado
- Colores `surface.*` y `accent.*` apuntan a variables CSS → responden al tema.

### `index.html` — Actualizado (PWA completo)
- `<link rel="manifest" href="/manifest.json" />`
- `<meta name="theme-color">` con `id="theme-color-meta"` (dinámico).
- `apple-mobile-web-app-*` para iOS.
- Registro del service worker en el `<script>` de arranque.

### `public/manifest.json` — Nuevo
- `display: standalone`, orientación portrait, colores de tema.

### `public/sw.js` — Nuevo
- Cache-first para assets estáticos; network-first para el resto.
- Manejo de `push` events con `showNotification`.
- Click en notificación → abre/focaliza la app en la URL indicada.

### `pages/OnboardingPage.jsx` — Reescrito (multi-paso)
| Paso | Contenido |
|------|-----------|
| 0 · Bienvenida | Descripción de la app con 3 features en tarjetas |
| 1 · Nombre | Username, display name y bio |
| 2 · Avatar | Upload de foto (con preview y botón de eliminar) |
| 3 · Batería | Slider con color dinámico y descripción |
| 4 · ¡Listo! | Grid 2×2 con siguientes pasos |
- `ProgressDots` animados.
- Validación por paso (no bloquea los opcionales).
- Botón "Saltar" en el paso de avatar.

### `pages/ProfilePage.jsx` — Mejorado
- **Banner de color** generado por la batería actual.
- **Avatar upload**: botón flotante `📷` sobre el avatar → `fileRef`.
- **Bio editable**: aparece en el modo edición junto al nombre.
- **Toggle de tema** (☀️/🌙) en la barra superior.
- **Notificaciones push**: panel en la sección Ajustes con toggle.
- **Skeleton loader** para el historial de batería.
- `useToast` para feedback de guardado/error.

### `pages/HomePage.jsx` — Mejorado
- **Toggle de tema** en la barra superior.
- **Avatar propio** como botón de navegación al perfil.
- **Nudge diario** si no se ha actualizado la batería hoy.
- **Skeletons** en lugar de `animate-pulse` genérico.
- `BottomNav` con badges de pendientes y mensajes no leídos.
- `useToast` reemplaza el estado `saved` sin feedback visual.

### `pages/UserProfilePage.jsx` — Actualizado
- Campo `bio` visible bajo el username.

### Resto de páginas (FriendsPage, PoolsPage, MessagesInboxPage, BadgesPage)
- `BottomNav` añadido y `pb-24` para que el contenido no quede bajo la barra.
- Colores `text-white` → `text-surface-text`, `text-slate-*` → `text-surface-muted`.

### `App.jsx` — Actualizado
- Árbol de providers: `ThemeProvider → ToastProvider → AuthProvider`.

---

## Base de datos (`supabase_schema_phase8.sql`)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint  TEXT NOT NULL,
  p256dh    TEXT NOT NULL,
  auth      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
```

RLS: los usuarios solo pueden gestionar sus propias suscripciones.

---

## Cómo aplicar

1. **Supabase SQL Editor** → ejecutar `supabase_schema_phase8.sql`

2. **(Opcional) Bucket de avatares**: en Supabase Storage, crear bucket
   `avatars` con acceso público. Si no se crea, la app usa data URLs como fallback.

3. **Deploy servidor** (Render lo hace automáticamente desde GitHub).

4. **Deploy cliente** (Render o Vercel).

---

## Checklist Fase 8

- [x] Perfil completo (bio, avatar, insignias destacadas)
- [x] Onboarding multi-paso para nuevos usuarios
- [x] Diseño responsive mobile-first (BottomNav + safe areas)
- [x] Notificaciones push (PWA: service worker + Web Push API)
- [x] Dark / Light mode (CSS variables + persistencia)
- [x] Toast notifications globales
- [x] Skeletons de carga
- [x] Avatar upload con fallback
- [x] PWA manifest + service worker con cache
