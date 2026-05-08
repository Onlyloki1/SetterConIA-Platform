# CONTEXTO-SESIONES — Setter con IA Platform

Fork de la plataforma B2C Smart Acquisition para vender un curso aparte llamado **"Setter con IA"**.

---

## Origen
- Fork creado: 2026-05-08
- Origen: `C:\Users\juanc\Desktop\Creador de guiones\platform\` (Smart Acquisition B2C)
- Repo origen: github.com/Onlyloki1/SmartAcquisition-Skool
- Decisión: link/dominio aparte, curso aparte, **misma estructura/funcionalidad**, branding nuevo.

## Repo
- GitHub: https://github.com/Onlyloki1/SetterConIA-Platform
- Owner: Onlyloki1
- Branch principal: `main`
- Visibilidad: público (igual que el B2C)

## Local
- Carpeta: `C:\Users\juanc\Desktop\Creador de guiones\setter-ia-platform\`
- Stack: Node 20 + Express + PostgreSQL + Resend + Discord OAuth + Firebase + Google Calendar
- `.env.example` documenta las 17 env vars que usa el código

## Railway
- Project name (a crear): `setter-con-ia`
- URL final esperada: `setter-con-ia-production.up.railway.app` (Railway autogenera)
- Postgres: instancia separada (NO comparte DB con el B2C)

---

## Cambios de branding aplicados al fork

| Archivo | Cambio |
|---|---|
| `public/login.html` | "Smart Acquisition" → "Setter con IA" (title + nav) |
| `public/admin.html` | title |
| `public/closer.html` | title + logo "SA" → "SI" |
| `public/dashboard.html` | "Smart Acquisition" → "Setter con IA" (title + topnav) |
| `services/email.js` | "Smart Acquisition" → "Setter con IA" en bienvenida + expiry, "SA" → "SI" en logo email, FROM |
| `server.js` | console log inicial |
| `db/schema.sql` | comentario header |
| `db/connection.js` | default ADMIN_EMAIL → `admin@setterconia.com` |
| `package.json` / `package-lock.json` | name + description |
| `PLAN.md` | header |
| `.env.example` | reemplazado con TODAS las env vars que el código realmente usa |

**Logo SVG (filesafe.space)**: NO se cambió todavía. Sigue usando el del B2C. Pendiente: subir uno nuevo o pedirle al user.

---

## Env vars (estrategia)

| Variable | Origen |
|---|---|
| `DATABASE_URL` | NUEVA (Postgres del Railway nuevo) |
| `JWT_SECRET` | NUEVO (random) |
| `PORT` | Railway autoinjecta |
| `NODE_ENV` | `production` |
| `PLATFORM_URL` | URL nueva de Railway |
| `UPLOAD_DIR` | `/data/uploads` (Railway volume) |
| `ADMIN_EMAIL` / `_PASSWORD` | A definir |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | **Reusa B2C** |
| `DISCORD_BOT_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_GUILD_ID` | **Reusa B2C** (mismo bot, mismo server PRIME HUB 2) |
| `DISCORD_ROLE_ID` | ⚠️ **NUEVO rol** "Setter con IA" — hay que crearlo en Discord |
| `DISCORD_INACTIVE_ROLE_ID` | Reusa o nuevo |
| `DISCORD_REDIRECT_URI` | URL nueva |
| `FIREBASE_SERVICE_ACCOUNT` | **Reusa B2C** |
| `GOOGLE_CLIENT_ID` / `_SECRET` | **Reusa B2C** |

---

## Pendientes (post-deploy)

- [ ] Crear rol "Setter con IA" en Discord PRIME HUB 2 → setear `DISCORD_ROLE_ID`
- [ ] Logo nuevo (opcional)
- [ ] Cargar contenido del curso (módulos/lecciones) desde el panel admin
- [ ] Producto + precio nuevo en Stripe (o sistema de pago equivalente)
- [ ] Dominio custom (post-deploy)
- [ ] Agregar URL de redirect del nuevo Discord redirect en el OAuth app de Discord

---

## Sesión 2026-05-08 — DEPLOYED ✅

**URL pública**: https://setterconia-platform-production.up.railway.app
**Login**: https://setterconia-platform-production.up.railway.app/login.html
**Admin email**: juancruzbernal24@gmail.com
**Admin password**: Jotac123.. (mismo que B2C — cambiar si querés)

### Railway IDs
- Project ID: `cfd73c5b-088e-4f6a-8404-26409dd5124b` (nombre: `setter-con-ia`)
- Environment ID: `bb4e7a7c-fb57-43bf-9554-9ac3a1e99f23` (production)
- Service ID: `689e4e1b-fcf7-4ecf-9b47-848f427fdebd` (SetterConIA-Platform)
- Volume: `setterconia-platform-volume` montado en `/data` (5354693d-badd-457f-8e51-2c0077d5ce2b)
- Postgres: instancia separada del B2C
- Dominio: `setterconia-platform-production.up.railway.app` target port 3000 (PORT=3000 override)

### Lo que hicimos
1. Fork local `platform/` → `setter-ia-platform/` (sin node_modules ni uploads)
2. Rebranding: "Smart Acquisition" → "Setter con IA" en HTML, emails, server, schema, package.json (logo "SA" → "SI")
3. `.env.example` reescrito con las 17 vars que el código realmente usa
4. Repo GitHub: https://github.com/Onlyloki1/SetterConIA-Platform (público) — commits `1a18c76` (fork) + `10b3a19` (fix bug user_credentials)
5. Railway via agent-browser CLI + GraphQL API directo:
   - Project + Postgres + repo conectado (todo via UI)
   - Renombrado a `setter-con-ia` via API
   - 17 env vars via `variableCollectionUpsert` (1 sola call para todas)
   - Volume `/data` agregado via `volumeCreate`
   - PORT=3000 override via `variableUpsert` (Railway autoinyecta 8080 sino)
   - Dominio público generado port 3000

### Bug arreglado
`db/connection.js`: el `ALTER TABLE user_credentials ADD COLUMN links` se ejecutaba ANTES del `CREATE TABLE user_credentials`. En el B2C funciona porque la tabla ya existe (migración previa) — en una DB fresh falla. Movido el ALTER a después del CREATE.

### Env vars seteadas (todas reusan B2C salvo las marcadas)
| Variable | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres del nuevo project) |
| `JWT_SECRET` | **NUEVO** — `setter-ia-prod-jwt-2026-q9m3vK8sL2nX5pR7` |
| `NODE_ENV` | production |
| `PORT` | 3000 (override Railway default 8080) |
| `PLATFORM_URL` | **NUEVO** — `https://setterconia-platform-production.up.railway.app` |
| `UPLOAD_DIR` | `/data/uploads` |
| `ADMIN_EMAIL` | juancruzbernal24@gmail.com (mismo B2C) |
| `ADMIN_PASSWORD` | Jotac123.. (mismo B2C) |
| `RESEND_API_KEY` | (vacío — B2C no lo usa) |
| `RESEND_FROM_EMAIL` | "Setter con IA <onboarding@resend.dev>" |
| `DISCORD_BOT_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_GUILD_ID` | mismos B2C |
| `DISCORD_ROLE_ID` | `1283114078272753782` (mismo "Principiante" del B2C) — **cambiar al rol "Setter con IA" cuando se cree** |
| `DISCORD_INACTIVE_ROLE_ID` | mismo B2C |
| `DISCORD_REDIRECT_URI` | **NUEVO** — `https://setterconia-platform-production.up.railway.app/api/client/discord-callback` |
| `FIREBASE_SERVICE_ACCOUNT` | mismo B2C (proyecto `extension-prime-outbound`) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | mismos B2C |

### Pendientes (se hacen DESPUÉS, no bloquean el funcionamiento básico)
- [ ] **Discord Developer Portal**: agregar `https://setterconia-platform-production.up.railway.app/api/client/discord-callback` a las redirect URIs autorizadas del OAuth app (sino el OAuth de Discord no va a funcionar para los users del Setter con IA)
- [ ] **Discord PRIME HUB 2**: crear rol nuevo "Setter con IA" → tomar el role ID y reemplazar `DISCORD_ROLE_ID` (sino los users nuevos van a recibir el rol "Principiante" del B2C que comparten el mismo server)
- [ ] **Google Cloud Console**: agregar la URL nueva a Authorized redirect URIs del OAuth app (si se va a usar Google Calendar)
- [ ] **Logo nuevo** (sigue usando el SVG del B2C en filesafe.space)
- [ ] **Cargar contenido del curso** desde `/admin.html` (login con admin) — módulos, lecciones, recursos
- [ ] **Producto + precio en Stripe** (o sistema de pago)
- [ ] **Dominio custom** (ej `setter.ascendx.com` apuntando al CNAME de Railway)
