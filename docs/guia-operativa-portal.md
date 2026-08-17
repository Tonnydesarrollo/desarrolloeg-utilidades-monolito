# Guia operativa del portal Desarrollo EG

Fecha: 2026-07-27

Esta guia resume que pantalla usar en cada caso para que soporte, QA y desarrollo no tengan que adivinar el flujo correcto.

## 1. Punto de entrada

- `GET /` y `GET /login`
- Uso: acceso al portal y autenticacion.
- Lectura: si el usuario no ha iniciado sesion, aqui debe empezar.

## 2. Home autenticada

- `GET /dashboard`
- Uso: tablero principal despues de autenticar.
- Lectura: es la pantalla para orientarse, ver acciones principales y entrar a modulos operativos.

## 3. Resumen operativo

- `GET /status`
- Uso: tablero ejecutivo y diagnostico rapido.
- Lectura: muestra salud general, alertas y accesos a vistas tecnicas o de seguimiento.

## 4. Jobs

- `GET /jobs/view`
- Uso: vista humana de operacion.
- Lectura: aqui debe entrar una persona que quiere entender que jobs estan fallando o activos.

- `GET /jobs`
- Uso: contrato tecnico JSON.
- Lectura: consumir desde integraciones, scripts o monitoreo.

- `GET /jobs/health`
- Uso: salud agregada de jobs.
- Lectura: verificar fallos, bloqueos por credenciales y ejecuciones activas.

## 5. WhatsApp Capacitadores

- `GET /whatsapp-capacitadores`
- Uso: landing operativa del modulo.
- Lectura: inicio natural para abrir QR, health o resolver acceso.

- `GET /whatsapp-capacitadores/qr`
- Uso: QR para reconectar o revisar el bot.
- Lectura: nunca debe sentirse como una pantalla terminal sin retorno.

## 6. Planeacion

- `GET /Planeacion-ley/`
- Uso: planeacion operativa con shell comun.
- Lectura: sirve para ver mapa, calendario y editar sucursales.

- `GET /api/branches`
- Uso: contrato tecnico de datos para la vista de Planeacion.
- Lectura: consumo tecnico, no pantalla de usuario.

## 7. Facturacion

- `GET /facturacion/cotizacion/html`
- Uso: vista de cotizacion para lectura humana.
- Lectura: pantalla operativa con shell comun y regreso claro al portal.

- `GET /facturacion/cotizacion/:id/html`
- Uso: cotizacion individual renderizada.
- Lectura: abre un documento operativo concreto.

## 8. Solventaciones

- `GET /SOLVENTACIONES/html`
- Uso: vista operativa principal.
- Lectura: revisar y resolver sin saltar entre superficies distintas.

- `GET /SOLVENTACIONES/pdf`
- Uso: salida imprimible o documental.
- Lectura: version de entrega o archivo.

## 9. Modulos ligeros

- `GET /contabilidad`
- `GET /CONSTANCIAS/`
- `GET /SUCURSALES-DOCS/`
- `GET /FALTANTES-LEY/`
- `GET /POLIZA_LEY/`
- `GET /SEPARAR-PIPC/`

Uso: utilidades de apoyo y superficies ligeras dentro del mismo sistema visual.

## 10. Regla rapida de navegacion

- Si el usuario necesita entrar, va a `/login`.
- Si el usuario necesita decidir que hacer, va a `/dashboard`.
- Si el usuario necesita revisar salud o incidencias, va a `/status` o `/jobs/view`.
- Si el usuario necesita una accion operativa concreta, va al modulo especifico.
- Si el usuario necesita un contrato tecnico, va al endpoint JSON o health correspondiente.

## 11. Criterio de soporte

- Las pantallas orientadas a personas deben mostrar `main`, `h1` o un equivalente visual claro.
- Las pantallas tecnicas deben decirlo de forma explicita.
- Toda superficie principal debe ofrecer regreso visible al dashboard o al nivel padre.
