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
- `GET /jobs`
- `POST /jobs/:jobId/run`
- `GET /clubfactura/health`
- `GET /whatsapp-capacitadores/health`

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
