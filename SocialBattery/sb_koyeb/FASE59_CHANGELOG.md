# 💬 SocialBattery — Fase 59: Chat de quedada (pool chat)

## Resumen de cambios

Cada quedada (`hangout_pool` / "pool") tiene ahora su propio chat grupal,
igual que los grupos de amigos (Fase 10), para que los apuntados puedan
coordinarse antes del plan. Se accede pulsando el nuevo botón **💬 Chat**
que aparece a la derecha del nombre de la quedada, dentro de la ficha de
detalle (`ParticipantsSheet`).

---

## Base de datos

### `supabase_schema_phase59_pool_chat.sql` — Nuevo
Ejecutar en Supabase Dashboard → SQL Editor **después** de `supabase_schema.sql`.

- **`pool_messages`** — mensajes del chat (texto o imagen), mismo patrón que
  `group_messages`. RLS: solo los usuarios presentes en `pool_participants`
  para ese `pool_id` pueden leer/escribir.
- **`pool_conversation_clears`** — registro de "vaciar chat" por usuario
  (solo afecta a su propia vista, igual que `group_conversation_clears`,
  Fase 58).
- Añade `pool_messages` a la publicación `supabase_realtime` (necesario para
  que las suscripciones `postgres_changes` disparen).

---

## Backend (`/server`)

### `routes/pools.js` — Actualizado
Nuevas rutas, protegidas con `requireAuth` y verificación de pertenencia a
`pool_participants` (solo los apuntados a la quedada pueden ver/escribir):

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/pools/:id/messages` | Historial del chat + `cleared_at` del usuario |
| POST | `/api/pools/:id/messages` | Enviar mensaje de texto |
| POST | `/api/pools/:id/messages/image` | Enviar una imagen (multer, 8 MB máx.) |
| POST | `/api/pools/:id/clear` | Vaciar el chat (solo para mí) |

- **`broadcastPoolChatMessage()`** — igual que `broadcastGroupMessage` en
  `routes/groups.js`: al enviar un mensaje, difunde un evento Realtime
  `new_pool_message` al canal personal de cada apuntado
  (`pool-chat-notif-{userId}`, con service key, sin RLS) y dispara un
  web-push para quien tenga la app cerrada.

---

## Frontend (`/client`)

### `pages/PoolChatPage.jsx` — Nuevo
Interfaz de chat grupal para una quedada, en `/pools/:poolId/chat`:
- Cabecera con emoji + nombre de la quedada + nº de apuntados, y menú
  `⋯` con la opción **Vaciar chat** (mismo patrón que `GroupChatPage.jsx`).
- Mensajes de texto e imagen con burbujas (reutiliza los estilos de burbuja
  configurados en Ajustes), agrupados por fecha.
- Envío optimista de mensajes/imágenes, con reintento visual si falla.
- Suscripción Realtime (`postgres_changes` sobre `pool_messages`) para
  recibir mensajes de otros apuntados al instante.

### `pages/PoolsPage.jsx` — Actualizado
- `ParticipantsSheet`: nuevo botón **💬 Chat** a la derecha del nombre de la
  quedada (estilo azul con hover, coherente con la insignia "🌐 Amigos" ya
  existente en las tarjetas de pool). Navega a `/pools/:id/chat`.

### `App.jsx` — Actualizado
- Nueva ruta `/pools/:poolId/chat` → `PoolChatPage`.

### `hooks/useMessageNotifications.js` — Actualizado
- Nueva suscripción al canal `pool-chat-notif-{userId}` (evento
  `new_pool_message`) para notificar en la app cuando llega un mensaje al
  chat de una quedada y el usuario no está viéndolo en ese momento.
