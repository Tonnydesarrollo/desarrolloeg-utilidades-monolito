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
- Jobs nativos para ClubFactura y CasaLey
- Scheduler interno para sincronizaciones recurrentes
- Servicio opcional de WhatsApp para capacitadores (`/whatsapp-capacitadores/health`)

## Endpoints utiles

- `GET /health`
- `GET /jobs`
- `POST /jobs/:jobId/run`
- `GET /clubfactura/health`
- `GET /whatsapp-capacitadores/health`
