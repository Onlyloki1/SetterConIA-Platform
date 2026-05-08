# Plan: Plataforma Educativa Setter con IA

## Stack
- **Backend**: Node.js + Express
- **DB**: PostgreSQL (Railway)
- **Auth**: bcrypt + JWT + cookies httpOnly
- **Frontend**: HTML/CSS/JS vanilla (mismo estilo onboarding)
- **Deploy**: Railway (web service + PostgreSQL addon)

## Estructura de la app

```
platform/
├── server.js              # Express server principal
├── package.json
├── .env.example
├── db/
│   └── schema.sql         # Tablas PostgreSQL
├── middleware/
│   └── auth.js            # JWT middleware
├── routes/
│   ├── auth.js            # Login/logout
│   ├── admin.js           # CRUD usuarios, módulos, contenido
│   └── client.js          # Vista cliente
├── public/
│   ├── css/
│   │   └── style.css      # Estilos globales (tema onboarding)
│   ├── js/
│   │   ├── admin.js       # Lógica panel admin
│   │   └── client.js      # Lógica vista cliente
│   ├── login.html         # Pantalla login (estilo pw-screen)
│   ├── admin.html         # Panel admin
│   └── dashboard.html     # Dashboard cliente
└── uploads/               # PDFs subidos
```

## Base de datos (PostgreSQL)

### Tablas:
1. **users** - id, email, password_hash, name, role (admin/client), created_at
2. **modules** - id, title, description, order_position, created_at
3. **lessons** - id, module_id, title, description, content_type (video/pdf/link), content_url, order_position
4. **resources** - id, title, description, file_url, resource_type (pdf/link), created_at
5. **user_progress** - id, user_id, lesson_id, completed, completed_at

## Funcionalidades

### Panel Admin:
- Crear/editar/eliminar usuarios (email + contraseña)
- Crear/editar/eliminar módulos
- Agregar lecciones a módulos (video Loom, PDF, link)
- Subir PDFs
- Agregar recursos a la biblioteca
- Ver progreso de cada cliente

### Dashboard Cliente:
- Login con email/contraseña
- Ver módulos y lecciones organizadas
- Marcar lecciones como completadas
- Ver PDFs inline + descargar
- Videos Loom embebidos
- Biblioteca de recursos
- Barra de progreso por módulo

## Pasos de implementación:

1. Setup proyecto (package.json, server.js, .env)
2. Schema PostgreSQL
3. Middleware auth (JWT)
4. Rutas auth (login/logout)
5. CSS global (tema onboarding)
6. Login page
7. Panel admin (HTML + JS + rutas API)
8. Dashboard cliente (HTML + JS + rutas API)
9. Upload de PDFs
10. Sistema de progreso
