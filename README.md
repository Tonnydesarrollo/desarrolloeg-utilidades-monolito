# DESARROLLOEG_UTILIDADES_MONOLITO

Base nueva para consolidar `DESARROLLOEG_UTILIDADES` en un solo proyecto, sin modificar lo existente.

## Modulos iniciales

- contabilidad
- facturacion
- constancias
- planeacion
- integrations
- jobs

## Cobertura actual del monolito

- Facturacion y proxy de descargas ClubFactura (`/clubfactura/*`)
- Jobs nativos para ClubFactura, CasaLey y Pedidos/Liberaciones
- Scheduler interno para sincronizaciones recurrentes
- Servicio opcional de WhatsApp para capacitadores (`/whatsapp-capacitadores/health`)

## Endpoints utiles

- `GET /health`
- `GET /`
- `GET /login`
- `GET /auth/google/start`
- `GET /auth/google/callback`
- `GET /dashboard`
- `GET /dashboard/general`
- `GET /dashboard/capacitador/:rowId`
- `GET /jobs`
- `POST /jobs/:jobId/run`
- `GET /clubfactura/health`
- `GET /whatsapp-capacitadores/health`

## Portal de acceso

La portada de `apps.desarrolloeg.com` ahora funciona como portal de acceso por correo.

- Los usuarios se validan contra la tabla `EMPLEADOS` de AppSheet.
- `PUESTO` decide el rol:
  - `ADMIN`: `GERENTE GENERAL`, `DIRECTOR GENERAL`, `MEJORA CONTINUA`
  - `CAPACITADOR`: `CAPACITADOR`
- Los capacitadores ven su dashboard personal y conservan acceso libre a `CONSTANCIAS`.
- Los admins ven el dashboard general, las rutas internas y la lista de dashboards de capacitadores.

Variables nuevas recomendadas:

- `PORTAL_AUTH_SECRET`
- `PORTAL_SESSION_TTL_HOURS`
- `PORTAL_EMPLOYEES_CACHE_TTL_MS`
- `PORTAL_SESSION_COOKIE_NAME`
- `PORTAL_APPSHEET_TABLE_EMPLEADOS`
- `PORTAL_EMPLEADOS_*`
- `PORTAL_GOOGLE_CLIENT_ID`
- `PORTAL_GOOGLE_CLIENT_SECRET`
- `PORTAL_GOOGLE_REDIRECT_URI`
- `PORTAL_GOOGLE_ALLOWED_DOMAINS`
- `PORTAL_CONSTANCIAS_BASE_URL`

### Configuracion de Google OAuth

1. Entra a Google Cloud Console y selecciona o crea un proyecto nuevo.
2. Ve a `APIs y servicios > Pantalla de consentimiento de OAuth`.
3. Completa el nombre de la app y el correo de soporte.
4. Si tu dominio pertenece a Google Workspace, usa tipo `Internal` si aparece disponible.
5. Si no puedes usar `Internal`, deja la app en `External` y agrega los correos de prueba mientras la publicas.
6. Ve a `APIs y servicios > Credenciales`.
7. Crea un `OAuth client ID` de tipo `Web application`.
8. Agrega este redirect URI exacto:

   - `https://apps.desarrolloeg.com/auth/google/callback`

9. Copia el `Client ID` y el `Client Secret` en estas variables:

   - `PORTAL_GOOGLE_CLIENT_ID`
   - `PORTAL_GOOGLE_CLIENT_SECRET`

10. Si quieres limitar el acceso a un dominio de Workspace, agrega uno o varios dominios en:

   - `PORTAL_GOOGLE_ALLOWED_DOMAINS`

11. Si necesitas cambiar el dominio base de Constancias, configura:

   - `PORTAL_CONSTANCIAS_BASE_URL`

12. Reinicia el contenedor para que tome las nuevas variables.

Notas:

- El `redirect_uri` debe coincidir exactamente con lo que registras en Google Cloud, incluyendo `https` y la ruta.
- El `client secret` de los clientes OAuth web solo se muestra al crearse, así que guárdalo en un lugar seguro.
- Si usas un entorno local, puedes registrar un redirect URI adicional de `http://localhost:4100/auth/google/callback`.

## Docker

El repo ya incluye:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

La imagen instala Node 22 y Chromium para poder correr `whatsapp-web.js` dentro del contenedor.

### 1. Crear el archivo de entorno para Docker

Usa la plantilla:

```bash
cp .env.example .env.docker
```

Llena en `.env.docker` los secretos y llaves reales:

- AppSheet
- ClubFactura
- CasaLey
- Google
- WhatsApp

No pongas rutas locales de Windows en `.env.docker`; `docker-compose.yml` ya inyecta rutas Linux portables dentro del contenedor.

### 2. Crear carpetas locales persistentes

Estas carpetas viven fuera de la imagen y se pueden copiar a otra maquina:

```text
runtime/
secrets/
publicimg/
```

Estructura sugerida:

```text
secrets/
  facturacion/
    credentials.json
  pedidos/
    credentials.json
  whatsapp/
    credentials.json

runtime/
  facturacion/
    token.json
  pedidos/
    token.json
  jobs/
    facturas/
    casaley/
    pedidos/
  whatsapp-capacitadores/
    session/
    tmp/
    token.json
```

### 3. Levantar el contenedor

```bash
docker compose up -d --build
```

### 4. Validar

```bash
curl http://localhost:7000/health
curl http://localhost:7000/jobs
```

## Migracion a otra maquina

Para mover el monolito completo a otra PC:

1. Clona el repo privado.
2. Copia `.env.docker`.
3. Copia `secrets/`.
4. Copia `runtime/` si quieres conservar snapshots, tokens y la sesion de WhatsApp.
5. Ejecuta `docker compose up -d --build`.

Si no copias `runtime/`, los jobs reconstruyen su estado local y WhatsApp pedira QR otra vez.
