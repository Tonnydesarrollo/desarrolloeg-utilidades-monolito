# WhatsApp dev independiente

Este servicio ejecuta el bot actual en un contenedor separado del monolito dev.
Produccion no cambia: si `WHATSAPP_CAP_SERVICE_URL` no existe, el monolito sigue
usando su implementacion integrada.

## Operacion

`scripts/start-dev.ps1` levanta sincronizador, bot y monolito. Docker solo recrea
el bot cuando cambia su imagen o configuracion. Su sesion queda en
`runtime-dev/whatsapp-dev/session` y sobrevive a reconstrucciones del monolito.

Estado y QR:

- `http://localhost:7001/whatsapp-capacitadores/health`
- `http://localhost:7001/whatsapp-capacitadores/qr`

Actualizar unicamente el monolito:

```powershell
docker compose -f docker-compose.dev.yml up -d --build --no-deps monolito-dev
```

Actualizar unicamente el bot:

```powershell
docker compose -f docker-compose.dev.yml up -d --build --no-deps whatsapp-dev
```

El bot dev solo atiende al numero de prueba configurado en Compose y desactiva
el fallback de identificadores LID. El API interno usa un token aleatorio guardado
en `runtime-dev/whatsapp-dev/service-token` y no publica el puerto 7010 al host.

La autorizacion de Google Drive es independiente. Hasta guardar un token OAuth en
`runtime-dev/whatsapp-dev/google-token.json`, las consultas y menus funcionan,
pero las cargas a Drive no. No se copia automaticamente la autorizacion productiva.
