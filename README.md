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

Para CasaLey y ClubFactura, el scheduler ya puede operar en modo de polling corto usando:

- `CASALEY_SYNC_INTERVAL_SECONDS`
- `FACTURAS_SYNC_INTERVAL_SECONDS`

Con `runOnStart=1` y un intervalo bajo, el monolito queda revisando casi en tiempo real sin saturar AppSheet.

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

La portada de `apps.desarrolloeg.com` funciona como portal de acceso por correo.

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
- El `client secret` de los clientes OAuth web solo se muestra al crearse, asi que guardalo en un lugar seguro.
- Si usas un entorno local, puedes registrar un redirect URI adicional de `http://localhost:4100/auth/google/callback`.

## Docker

El repo ya incluye:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `scripts/install-docker-monolith.ps1`
- `scripts/update-docker-monolith.ps1`

La imagen instala Node 22 y Chromium para poder correr `whatsapp-web.js` dentro del contenedor.
El despliegue recomendado es siempre el mismo en cualquier servidor: clonar el repo, copiar el archivo de entorno y levantar `docker compose`.
El host solo necesita Docker y Git; el resto de dependencias corre dentro del contenedor.
Para CasaLey, el scheduler automatizado ahora separa tres corridas: `pagos-ley`, `cheques-ley` y `facturas-ley`. El job grande `casaley-sync-appsheet` queda como manual.

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

Si necesitas reponer facturas de ClubFactura que no quedaron en AppSheet, activa una re-sincronizacion forzada con:

- `FACTURAS_FORCE_RESYNC=1`

Eso hace que el job vuelva a enviar las filas del rango actual aunque la replica local las marque como ya sincronizadas.

Para el job de `PEDIDOS_LEY`, puedes activar una relectura completa con:

- `PEDIDOS_FORCE_REFRESH=1`

Ese modo vuelve a abrir los PDF aunque la fila ya tenga datos completos, lo que ayuda cuando sospechas que la informacion quedo desactualizada o el extractor mejoro y quieres reescribir valores existentes.

No pongas rutas locales de Windows en `.env.docker`; `docker-compose.yml` ya inyecta rutas Linux portables dentro del contenedor.
Para CasaLey, si no defines fechas manuales, el sistema arma automaticamente el rango del primer dia al ultimo dia del mes actual.

### 2. Crear carpetas locales persistentes

Estas carpetas viven fuera de la imagen y se pueden copiar a otra maquina:

```text
runtime/
secrets/
publicimg/
cloudflared/
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

cloudflared/
  config.yml
  desarrolloeg.json
```

El directorio `cloudflared/` queda dentro del compose y no depende de rutas del host. El tunnel usa el servicio `monolito` por red interna, asi que no importa desde que servidor se arranque mientras el stack tenga el mismo archivo de credenciales.

### 3. Levantar el stack

```bash
docker compose up -d --build
```

Ese compose levanta `monolito` y `cloudflared`.

El tunnel corre dentro de Docker y apunta al servicio `monolito` por red interna.
Si quieres forzar el arranque completo de CasaLey en una sola corrida, usa el job `casaley-sync-appsheet` desde `/jobs` o dale `CASALEY_SYNC_ALL_ENABLED=1`.

### 4. Instalador y autoactualizacion

Para dejar un nodo listo de una vez, ejecuta:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-docker-monolith.ps1
```

Ese instalador:

- prepara `.env.docker` si falta
- crea las carpetas persistentes
- levanta el stack con Docker
- registra una tarea de arranque
- registra una tarea de actualizacion que consulta `origin/main` y reconstruye el stack cuando hay cambios

Si quieres apuntar a otra rama o cambiar el intervalo de revision:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-docker-monolith.ps1 -Branch main -UpdateIntervalMinutes 15
```

### 5. Despliegue en mas de un servidor

Si quieres alta disponibilidad, puedes desplegar el mismo stack en mas de una maquina:

1. Copia el mismo repo y el mismo `.env.docker`.
2. Copia `runtime/`, `secrets/`, `publicimg/` y `cloudflared/` a cada servidor.
3. Asegura que todos los nodos usen el mismo tunnel de Cloudflare.
4. Arranca el mismo `docker compose up -d --build` en cada maquina.

Con eso, `cloudflared` puede abrir mas de una conexion al mismo tunnel y el acceso externo deja de depender de un solo host.

Importante: el monolito ya tiene coordinacion de lider/standby para servicios singulares, pero no tiene un lock distribuido real para correr jobs identicos de forma activa-activa en varios nodos al mismo tiempo. Para evitar duplicidad, deja `CLUSTER_ENABLED=1` solo en el nodo que deba tomar liderazgo, o agrega un backend compartido de bloqueo si despues quieres ejecucion activa-activa de jobs.

### 6. Validar

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
5. Copia `cloudflared/`.
6. Ejecuta `docker compose up -d --build`.

Si no copias `runtime/`, los jobs reconstruyen su estado local y WhatsApp pedira QR otra vez.
