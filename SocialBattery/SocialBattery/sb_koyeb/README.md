# 🔋 SocialBattery

Una red social para gestionar tu energía social. Establece tu "batería" del 0 al 100, conecta con amigos que tienen niveles similares y propón quedadas cuando tu energía coincide.

## Stack
| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Frontend | React + Tailwind (Vite) | SPA rápida, componentes reutilizables |
| Backend | Node.js + Express | Ligero, buen ecosistema |
| Base de datos | Supabase (PostgreSQL) | Free tier generoso, auth + realtime incluidos |
| Servidor | Render.com | Free tier con CI/CD desde GitHub |
| WebSockets | Supabase Realtime | Mensajes y presencia sin coste extra |

---

## Fases completadas

### ✅ Fase 1 — Fundación & Auth
- Auth completo (email + password via Supabase Auth)
- Tabla `users` con perfil público
- Onboarding con username único
- Deploy pipeline en Render

### ✅ Fase 2 — Batería Social (core feature)
- Slider de batería 0–100 con colores dinámicos 🔴🟡🟢
- Historial de batería (`battery_history`)
- Feed de amigos ordenado por cercanía de nivel
- Gráfico de línea + heatmap día/hora
- Batería estimada ⚡ cuando no se ha actualizado hoy

### ✅ Fase 3 — Sistema de Amistades
- Buscar usuarios por username
- Enviar / aceptar / rechazar solicitudes de amistad
- Lista de amigos en tiempo real (Supabase Realtime)
- **Indicador de presencia online/offline** en tiempo real
- Badge de notificaciones para solicitudes pendientes
- Contador "X en línea" en cabecera de amigos

### ✅ Fase 4 — Mensajes Directos
- Chat 1:1 con Supabase Realtime (sin polling)

### ✅ Fase 5 — Pool de Quedadas
- Crear pools con actividad, descripción, fecha/hora, ubicación y capacidad
- Visibilidad configurable: **amigos** o **público** (visible para cualquier usuario)
- Feed de pools activos con tab "Amigos/Públicos", "Mis planes" y "Mis pools"
- **Unirse / Salir** con gestión automática de estado (`open` → `full` cuando se llena)
- El creador puede **cancelar** el pool con un clic
- Detección automática de emoji según actividad (☕🎬🍺⚽🎵🎮...)
- Realtime: el feed se actualiza al instante cuando alguien se une o cancela
- Banner en HomePage cuando hay planes disponibles de amigos
- Cron diario que cierra automáticamente pools cuya hora ha pasado
- **Insignia 📅 Organizador Nato** al crear 5+ pools

### ✅ Fase 6 — Batería Estimada (algoritmo)
- Cron job cada hora en Render (gratuito, sin servicios externos)
- **Lógica dual de ponderación:**
  - *Proximidad horaria:* datos de horas cercanas a la hora actual reciben más peso
  - *Recencia:* entradas más recientes tienen mayor peso que antiguas
- Requisito: ≥2 registros históricos en ese `day_of_week` concreto
- `battery_updated_at` se actualiza al estimar → UI muestra "estimado hace Xmin"
- `battery_is_estimated` se resetea a `false` al guardar manualmente
- **UI:** badge `⚡ Batería estimada por IA · No actualizada hoy` en BatterySlider
- **FriendCard:** badge `⚡est.` amarillo junto al nombre del amigo
- **HomePage:** aviso "⚡ Estimado" en la tarjeta de tu propia batería
- **UserProfilePage:** badge "⚡ Estimada" junto a la barra de batería
- **Propuestas de quedada** (🤝) con formulario propio:
  - Campo de actividad + campo opcional "¿cuándo?"
  - Botones "Me apunto ✓ / Paso ✕" para el receptor
  - Estado visual: pendiente → confirmada / rechazada
  - Actualización en tiempo real del estado
- Inbox con conversaciones, preview y contador de no leídos
- Indicador de lectura ✓✓ (leído por el receptor)
- **Estado online/offline del amigo** en la cabecera del chat
- Heartbeat automático: `last_seen_at` se actualiza cada 90s

---

## Setup local

### 1. Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta `supabase_schema.sql`
3. En **Authentication → Settings**, activa "Email confirmations" si quieres verificación

### 2. Variables de entorno

**server/.env**
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1N...   # service_role key (Settings → API)
PORT=3001
CLIENT_URL=http://localhost:5173
```

**client/.env**
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1N...  # anon key (Settings → API)
VITE_API_URL=http://localhost:3001/api
```

### 3. Iniciar
```bash
# Backend
cd server && npm install && npm run dev

# Frontend (en otra terminal)
cd client && npm install && npm run dev
```

---

## Deploy en Render.com (gratis)

El archivo `render.yaml` configura dos servicios:

| Servicio | Tipo | Build | Start |
|----------|------|-------|-------|
| socialbattery-api | Web Service | `npm install` | `node index.js` |
| socialbattery-client | Static Site | `npm run build` | — |

### Variables de entorno en Render
En cada servicio, añade las variables del `.env` correspondiente.  
Para el cliente, `VITE_API_URL` debe apuntar a la URL del servicio backend.

---

## API Reference

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/profile` | Crear perfil tras registro |
| GET | `/api/auth/me` | Perfil propio |

### Usuarios
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/users/search?q=` | Buscar por username |
| GET | `/api/users/:id` | Perfil público |
| PATCH | `/api/users/me` | Editar nombre / avatar |
| PATCH | `/api/users/me/seen` | Heartbeat online |

### Batería
| Método | Ruta | Descripción |
|--------|------|-------------|
| PATCH | `/api/battery` | Actualizar nivel |
| GET | `/api/battery/history` | Historial propio |
| GET | `/api/battery/friends` | Batería de amigos |

### Amistades
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/friends/request` | Enviar solicitud |
| PATCH | `/api/friends/request/:id` | Aceptar / rechazar |
| GET | `/api/friends/requests` | Solicitudes pendientes |
| GET | `/api/friends/status/:userId` | Estado con un usuario |
| GET | `/api/friends` | Lista de amigos |
| DELETE | `/api/friends/:friendId` | Eliminar amigo |

### Mensajes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/messages` | Inbox (conversaciones) |
| GET | `/api/messages/:friendId` | Conversación con un amigo |
| POST | `/api/messages` | Enviar mensaje o propuesta |
| PATCH | `/api/messages/:messageId/hangout` | Aceptar / rechazar quedada |
| PATCH | `/api/messages/:friendId/read` | Marcar como leídos |

### Insignias
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/badges` | Catálogo de insignias |

---

## Esquema de base de datos (resumen)

```
users                  battery_history
├── id                 ├── user_id → users
├── username           ├── level
├── display_name       ├── day_of_week
├── battery_level      ├── hour
├── last_seen_at  ← NUEVO (fase 4: presencia online)
└── ...

friendships            messages
├── requester_id       ├── sender_id → users
├── addressee_id       ├── receiver_id → users
└── status             ├── type (text | hangout_request)
   pending/accepted    ├── hangout_status ← NUEVO (pending/accepted/rejected)
   /rejected           ├── hangout_time ← NUEVO (texto libre)
                       └── read_at
```

---

## Próximas fases

- **Fase 5** — Pools de quedada (grupos abiertos con unirse/salir)
- **Fase 6** — Batería estimada por algoritmo (cron job)
- **Fase 7** — Insignias automáticas por comportamiento
- **Fase 8** — PWA con notificaciones push

---

## Despliegue de las fases 5 & 6

### 1. Ejecutar el schema en Supabase

```sql
-- En Supabase Dashboard → SQL Editor, ejecuta en orden:
-- 1. supabase_schema.sql        (si es instalación nueva)
-- 2. supabase_schema_phase56.sql  (políticas RLS pools + realtime + índices)
```

### 2. Rutas nuevas del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/pools?filter=active` | Feed de pools visibles |
| GET | `/api/pools?filter=mine` | Mis pools (creador) |
| GET | `/api/pools?filter=joined` | Pools en los que participo |
| GET | `/api/pools/:id` | Detalle de un pool |
| POST | `/api/pools` | Crear pool |
| POST | `/api/pools/:id/join` | Unirse a un pool |
| DELETE | `/api/pools/:id/leave` | Salir / cancelar (creador) |
| PATCH | `/api/pools/:id` | Actualizar pool (creador) |
| DELETE | `/api/pools/:id` | Cancelar pool (creador) |

### 3. Nuevas rutas del frontend

| Ruta | Componente |
|------|-----------|
| `/pools` | `PoolsPage.jsx` |

### 4. Variables de entorno (sin cambios)

Las mismas de fases 1–4. No se requieren nuevas variables.

### 5. Cron jobs activos en Render

| Schedule | Job | Fase |
|----------|-----|------|
| `0 * * * *` | estimateBatteries() | 6 |
| `0 0 * * *` | Cierre de pools expirados | 5 |

