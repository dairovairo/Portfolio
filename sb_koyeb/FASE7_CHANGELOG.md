# 🏅 SocialBattery — Fase 7: Insignias & Personalidad

## Qué se implementó

### Backend (`/server`)

#### `jobs/badges.js` — Motor de detección (reescrito completo)
- **Instant checks** (sin BD): `night_owl`, `early_bird`, `low_battery_hero`, `fully_charged`, `weekend_warrior`
- **Async checks** (con BD): `consistent_7` (7 días seguidos), `introvert_proud` (10+ días < 30%), `social_butterfly` (10+ días > 80%), `organizer_5` (5+ pools), `connector` (10+ amigos)
- `checkAndAwardBadges()` devuelve array de IDs de insignias **recién ganadas** (para la respuesta de la API)
- `checkOrganizerBadgeForUser()` — llamada desde pools al crear uno
- `checkConnectorBadgeForUsers()` — llamada desde friends al aceptar amistad (revisa ambos usuarios)

#### `routes/badges.js` — Nuevos endpoints
- `GET /api/badges` — Catálogo completo
- `GET /api/badges/my` — Insignias ganadas del usuario actual (con detalles)
- `GET /api/badges/user/:userId` — Insignias públicas de otro usuario

#### `routes/battery.js` — Actualizado
- `PATCH /api/battery` ahora devuelve `{ user, newBadges[] }` con las insignias recién ganadas

#### `routes/pools.js` — Actualizado
- `POST /api/pools` usa el helper compartido (elimina código duplicado) y devuelve `newBadges`

#### `routes/friends.js` — Actualizado
- `PATCH /api/friends/request/:id` dispara `checkConnectorBadgeForUsers()` al aceptar amistad

### Frontend (`/client`)

#### `components/BadgeUnlockModal.jsx` — Nuevo
- Modal de celebración con animación cuando se gana una insignia
- Soporte para múltiples insignias en secuencia (con indicador de progreso)
- Se puede cerrar tocando el backdrop o el botón "¡Genial!"

#### `pages/BadgesPage.jsx` — Nuevo
- Página dedicada `/badges` con todas las insignias
- **Agrupadas por categoría**: Batería, Hábitos, Social, Horarios
- **Barra de progreso** por categoría y total
- Insignias ganadas con emoji con glow + fecha de obtención
- Insignias sin ganar en gris con candado
- Hero card con progreso general del perfil

#### `pages/HomePage.jsx` — Actualizado
- Importa `BadgeUnlockModal`
- `saveBattery()` captura `newBadges` de la respuesta y dispara el modal
- Botón 🏅 en la barra de navegación → `/badges`

#### `pages/ProfilePage.jsx` — Actualizado
- Sección badges muestra earned first (8 max), con progress bar
- Link "Ver todas →" y botón de overflow a `/badges`
- Importa `BadgeUnlockModal` para futuros usos

#### `pages/UserProfilePage.jsx` — Actualizado
- Usa el nuevo endpoint `GET /api/badges/user/:id` para badges precisas

#### `App.jsx` — Actualizado
- Nueva ruta `<Route path="/badges" element={<BadgesPage />} />`

### SQL (`supabase_schema_phase7.sql`)
- RLS en `badges` (lectura pública para autenticados)
- RLS en `user_badges` (lectura pública para autenticados, escritura solo service_role)
- Realtime en `user_badges`
- Índices de rendimiento
- Función `get_badges_for_user()` (útil para debugging/RPC futuro)

## Cómo aplicar

1. En Supabase Dashboard → SQL Editor:
   - Ejecutar `supabase_schema_phase7.sql`

2. Deploy del servidor (Render lo hace automáticamente desde GitHub)

3. Deploy del cliente (Render o Vercel)

## Insignias disponibles

| ID | Nombre | Emoji | Condición |
|---|---|---|---|
| `night_owl` | Noctámbulo | 🦉 | Actualiza después de las 22h |
| `early_bird` | Madrugador Social | ☀️ | Actualiza antes de las 9h |
| `low_battery_hero` | Batería Crítica | 🪫 | Nivel ≤ 10% |
| `fully_charged` | Al 100% | ⚡ | Nivel = 100% |
| `weekend_warrior` | Guerrero del Finde | 🎉 | Activo sábado o domingo |
| `consistent_7` | Constante | 🔋 | 7 días seguidos actualizando |
| `introvert_proud` | Introvertido Feliz | 🧘 | 10+ días con batería < 30% |
| `social_butterfly` | Mariposa Social | 🦋 | 10+ días con batería > 80% |
| `organizer_5` | Organizador Nato | 📅 | 5+ pools creados |
| `connector` | Conector | 🤝 | 10+ amigos aceptados |
