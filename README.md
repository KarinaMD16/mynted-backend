# Mynted · Backend

API REST y WebSockets de **Mynted**, el marketplace y foro para coleccionistas de nicho. Proyecto final del curso EIF-409 Aplicaciones Informáticas Globales (UNA, II ciclo 2026).

Frontend: <https://github.com/KarinaMD16/mynted>

## Tecnologías

- NestJS 11 + TypeScript
- TypeORM + PostgreSQL
- JWT en cookies `httpOnly` (acceso y refresh), contraseñas con bcrypt
- Socket.IO (chat y notificaciones en tiempo real)
- Swagger (documentación de la API)
- Cloudinary (imágenes), Nodemailer (correos)
- Tipos de cambio: BCCR y Frankfurter
- Jest (pruebas unitarias y e2e)

## Requisitos

- Node.js 20 o superior y npm
- PostgreSQL 14 o superior
- Cuenta de Cloudinary (gratis) para subir imágenes
- Opcional: cuenta SMTP (por ejemplo Gmail con contraseña de aplicación) para los correos de recuperación de contraseña

## Instalación y ejecución

```bash
# 1. Instalar dependencias
npm install

# 2. Crear la base de datos vacía (las tablas se crean solas al arrancar)
createdb -U postgres mynted_db
#   o desde psql:  CREATE DATABASE mynted_db;

# 3. Configurar las variables de entorno
cp .env.example .env        # en Windows: copy .env.example .env
#   Edita .env con tus propios valores (ver la tabla de abajo)

# 4. Levantar el backend en modo desarrollo
npm run start:dev
```

El backend queda en **http://localhost:3000** y la documentación Swagger en **http://localhost:3000/api**.

> El CORS solo acepta el frontend en `http://localhost:5173`. Levanta el frontend en ese puerto (es el valor por defecto de Vite).

Al arrancar, se cargan automáticamente los catálogos iniciales: categorías, etiquetas, insignias, cosméticos de Mynted Pro y niveles de comisión. El esquema se sincroniza desde las entidades (`synchronize: true`), por lo que no hay migraciones; esto es solo para desarrollo.

## Variables de entorno

Todas están en `.env.example`. Las mínimas para correr el proyecto:

| Variable | Para qué sirve |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Conexión a PostgreSQL |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Secretos de los tokens (deben ser distintos y largos) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Subida de imágenes |
| `FRONTEND_URL` | URL del frontend (`http://localhost:5173`) |

Opcionales:

| Variable | Efecto si se deja vacía |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No se envían correos (recuperación de contraseña, cambio de correo) |
| `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Se desactiva ese inicio de sesión social |
| `BCCR_TOKEN` | Los tipos de cambio se obtienen solo de Frankfurter |
| `COMMISSION_BASE_RATE`, `COMMISSION_MIN_RATE` | Comisión base 5 % y mínimo 2 % |

Para generar un secreto aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Nunca subas tu `.env` ni contraseñas reales al repositorio.**

## Datos de ejemplo para la demostración

Los seeds llenan la base local con usuarios, comunidades, publicaciones, hilos y productos con fotos. No se ejecutan solos. Con el backend corriendo (y Cloudinary configurado), desde la raíz del repo y en este orden:

```bash
node scripts/seed-twilightbuns-products.js    # vendedor twilightbuns, comunidad My Little Pony Latam y 11 productos
node scripts/seed-community-users.js          # usuarios, posts, hilos, votos y comunidad de Minecraft
node scripts/seed-forum-test-data.js          # opcional: feeds de foro para Home y Explorar
```

- Contraseña de todos los usuarios sembrados: `Test1234` (por ejemplo `twilightbuns`, `lunadreamer`, `creeperqueen` o cualquier `seed_*`).
- Cada script acepta `--clean` para borrar lo que sembró.
- Más detalle en [`docs/SEEDS.md`](docs/SEEDS.md). Son solo para desarrollo local; no los ejecutes contra una base de producción.

### Cuenta de superadministrador

Para probar el panel de administración, registra un usuario normal y cámbiale el rol en la base de datos:

```sql
UPDATE users SET role = 'superadmin' WHERE username = 'tu_usuario';
```

## Pruebas

```bash
npm run test        # pruebas unitarias (Jest)
npm run test:cov    # con cobertura
npm run test:e2e    # pruebas de integración (requieren la base de datos configurada)
```

## Estructura

```
src/
  auth/ users/ user-tags/ user-communities/    Cuentas, sesión e intereses
  community/ moderation/ reports/              Comunidades, foro y moderación
  products/ search/ sellers/ reputation/       Marketplace, búsqueda y reseñas
  conversations/ notifications/                Chat 1 a 1 y notificaciones (WebSockets)
  payments/ pricing/ subscriptions/            Pasarela simulada, comisión y Mynted Pro
  badges/ cosmetics/                           Insignias y cosméticos de perfil
scripts/                                       Seeds de datos de ejemplo
docs/                                          Guías técnicas (API, pagos, moneda, chat, Pro, etc.)
test/                                          Pruebas e2e
```

## Documentación adicional

Las guías de la carpeta [`docs/`](docs/) explican los endpoints y flujos: `GUIA_FRONTEND.md`, `FLUJO_COMPRAS_PAGOS.md`, `GUIA_MONEDA_FRONTEND.md`, `GUIA_CHAT.md`, `GUIA_NOTIFICACIONES_FRONTEND.md`, `GUIA_PRO_FRONTEND.md`, entre otras.

## Pagos simulados

La pasarela **no cobra dinero real**. En el checkout, la tarjeta `4242 4242 4242 4242` aprueba el pago; otros números de prueba simulan rechazos.

## Autoría

Karina Moreno, Elein Rodríguez, Orlando Baltodano y Axel Badilla, 2026.
