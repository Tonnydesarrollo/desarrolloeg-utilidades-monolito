# Pedidos Ley Sender Service

Este Apps Script debe publicarse como Web App y ejecutarse con la cuenta
`contacto.gga.sc@gmail.com`.

## Script properties

Configura estas propiedades en el proyecto de Apps Script:

- `PEDIDOS_LEY_WEBAPP_SECRET`: secreto compartido que también debe ir en el monolito.
- `PEDIDOS_LEY_FROM_EMAIL`: opcional, por defecto usa `contacto.gga.sc@gmail.com`.

## Deploy

1. Abre el proyecto de Apps Script con la cuenta `contacto.gga.sc@gmail.com`.
2. Copia `Code.gs` y `appsscript.json`.
3. Publica como Web App.
4. Ejecuta como: `Me`.
5. Acceso: `Cualquiera con el enlace` o la opción que uses en tu entorno.
6. Copia la URL del Web App y guárdala en el monolito como:
   - `PEDIDOS_LEY_APPS_SCRIPT_WEBAPP_URL`
   - `PEDIDOS_LEY_APPS_SCRIPT_SECRET`

