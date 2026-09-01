# Arquitectura del portal, modulos y tiempo real

Fecha: 2026-08-26

Este documento deja fija la arquitectura actual del monolito DesarrolloEG y la regla de permisos por pantalla. La meta es que todas las pantallas lean de la base local persistente, se actualicen por webhook/auditoria y se comporten como una sola plataforma.

## Principio rector

- La plataforma no debe depender de consultar AppSheet en cada carga de pagina.
- La base local SQLite es la fuente de lectura para el portal.
- AppSheet sigue siendo fuente operativa para las tablas que nacen alla.
- Los procesos que nacen fuera de AppSheet escriben primero en local y solo suben a AppSheet cuando aplique.
- Los campos calculados de AppSheet no se guardan como verdad; se calculan o normalizan en backend local.
- El navegador no reconstruye datos; consume HTML/API del backend y recibe avisos de cambio por SSE.

## Flujo de datos

```text
AppSheet Bot
  -> sync.desarrolloeg.com/webhooks/appsheet
  -> SQLite local persistente
  -> tabla local auditoria_cambios
  -> monolito /api/app-shell/webhook
  -> reconciliacion de caches por auditoria
  -> evento SSE /api/app-shell/events?scope=portal
  -> dashboard recarga datos automaticamente
```

## Flujo de arranque

1. El contenedor de sync abre `data/desarrolloeg.sqlite`.
2. Si la BD local existe, se usa como lectura persistente.
3. El monolito precalienta caches compartidas desde la BD local.
4. El portal renderiza la primera respuesta desde cache/BD local.
5. El navegador abre `/api/app-shell/events?scope=portal` para escuchar cambios.

## Flujo de cambio desde AppSheet

1. AppSheet ejecuta un Bot en Add, Update o Delete.
2. El Bot manda JSON a `https://sync.desarrolloeg.com/webhooks/appsheet`.
3. El sync aplica insert/update/delete en SQLite.
4. El sync escribe el cambio en `auditoria_cambios`.
5. El sync notifica al monolito en `/api/app-shell/webhook`.
6. El monolito compara la auditoria local contra el cursor persistente.
7. Si hay cambios, actualiza caches afectadas y deja el cursor local igualado.
8. El monolito emite `app-shell-cache` por SSE.
9. El shell traduce el aviso a `desarrolloeg:data-changed`.
10. La pantalla activa invalida solo su DTO; el calendario sustituye sus eventos sin recargar el documento.

## Contratos HTTP de pantalla

- `/api/portal/bootstrap`: usuario, capacidades y vista inicial `calendario`.
- `/api/portal/calendar`: eventos normalizados para FullCalendar.
- `/api/portal/capacitaciones`: capacitaciones visibles segun alcance.
- `/api/portal/empresas`: empresas y sucursales normalizadas.
- `/api/portal/pedidos`: clasificacion operativa de pedidos.
- `/api/portal/notas`: entradas de hilo visibles para el usuario.

El navegador no consulta AppSheet. Estos contratos se alimentan desde la capa local persistente y se invalidan con auditoria/webhook.

## Flujo de cambio desde la plataforma

1. El usuario ejecuta una accion en el portal.
2. Si la tabla pertenece a AppSheet, el backend escribe en AppSheet.
3. Luego valida contra la auditoria/local sync.
4. Si AppSheet confirma el cambio por Bot, se actualiza la BD local.
5. El portal recibe el evento SSE y actualiza la pantalla.

## Reglas de persistencia por modulo

| Modulo | Origen de escritura | Lectura del portal | Sync a AppSheet | Notas |
| --- | --- | --- | --- | --- |
| Portal/Dashboard | AppSheet y acciones del portal | SQLite local/cache portal | Si la accion corresponde | Calendario, capacitaciones, diplomas, notas |
| Capacitaciones | AppSheet o portal | SQLite local/cache portal | Si | Bot obligatorio en AppSheet |
| Constancias | BD local/contexto local | SQLite local | Cambia `DIPLOMAS` en AppSheet cuando aplique | La vista HTML debe usar razon social y logo del cliente |
| Faltantes Ley | BD local/cache | SQLite local | No necesariamente | Se filtra por capacitador cuando aplique |
| Pedidos Ley | Casa Ley/Drive/local | SQLite local | Solo nuevos/cambiados que correspondan | Envio/reenvio conserva archivos y estado local |
| ClubFactura | Fetch/XML local | SQLite local | Solo nuevo o cambiado | Se llena primero local |
| Casa Ley pagos/facturas/cheques | Flujo Casa Ley local | SQLite local | Solo nuevo o cambiado | Consulta desde pagina de Casa Ley |
| PC Estatal | Fetch/local | SQLite local | No | No se envia a AppSheet |
| Facturacion/Cotizaciones | AppSheet/local segun tabla | SQLite local/cache facturacion | Si corresponde | Calculados se resuelven local |
| WhatsApp capacitadores | Local/session | Estado local | No | QR/link son mecanismos de sesion, no fuente de datos |
| Sucursales Docs | SQLite local | SQLite local | No por defecto | Usa labels y datos normalizados |
| Reportes/Inspecciones | SQLite local | SQLite local | Segun flujo | Debe evitar consultar AppSheet directo |
| Solventaciones | SQLite local | SQLite local | Segun flujo | Observaciones deben migrar a hilos |
| Poliza Ley | Archivo/local | Local | No | Consulta documental |
| Jobs | Backend local | Estado local | Segun job | Solo el lider del cluster debe correr jobs singleton |

## Auditoria y cache

- La tabla local `auditoria_cambios` es el disparador de reconciliacion.
- El cursor persistente vive en cache namespace `appsheet.audit.cursor`.
- Despues de aplicar un cambio, el cursor local debe quedar al mismo nivel que la auditoria usada.
- Si AppSheet falla, el portal no debe vaciar datos; debe seguir sirviendo SQLite/cache local.
- Si la auditoria no avanza pero el webhook llega, el SSE igualmente despierta al dashboard para evitar que el usuario tenga que refrescar.

## Tiempo real en el portal

Endpoint principal:

- `GET /api/app-shell/events?scope=portal`

Eventos:

- `init`: fija el cursor inicial de la pestaña.
- `app-shell-cache`: avisa que una tabla cambio o que se ejecuto refresh.
- `heartbeat`: mantiene viva la conexion.

Fallback:

- `GET /api/app-shell/cache/state?scope=portal` cada 3 segundos.

Regla de UX:

- Las pestañas antiguas necesitan una recarga para cargar el cliente SSE.
- Despues de cargar el cliente SSE, los cambios de AppSheet deben reflejarse sin refresh manual.

## Permisos por puesto

| Puesto | Vistas | Acciones | Alcance |
| --- | --- | --- | --- |
| Director general | Todas | Ver, crear, editar, eliminar | Todos |
| Mejora continua | Todas | Ver, crear, editar, eliminar | Todos |
| Gerente general | Todas | Ver, crear, editar | Todos |
| Capacitador | Calendario | Ver, crear, editar | Propios |
| Capacitador | Capacitaciones | Ver, crear, editar | Propios |
| Capacitador | Constancias faltantes | Ver | Propios |
| Capacitador | Crear constancias por capacitador | Ver, crear, editar | Propios |
| Capacitador | Crear constancias por capacitacion | Ver, crear, editar | Propios |
| Capacitador | Informacion de sucursales | Ver | Todos |
| Capacitador | Notas | Ver, crear, editar, eliminar | Propios; puede ver todos los hilos visibles |

## Pantallas objetivo

### Constancias faltantes

- Muestra capacitaciones sin constancias.
- Columnas minimas: sede y fecha.
- Para capacitador: solo propias.
- Para perfiles con permisos globales: todas.

### Crear constancias por capacitador

- Pantalla cargada directo en dashboard.
- Debe verse igual a `https://api-constancias.desarrolloeg.com/CONSTANCIAS/capacitaciones/ID_CAPACITACION/HTML`.
- Agrega selector de capacitaciones por sede y fecha.
- Al seleccionar una capacitacion, precarga sucursales y fecha.
- Incluye boton para cambiar `DIPLOMAS` de `false` a `true`.
- Si el usuario tiene permisos globales, muestra selector de capacitador.

### Crear constancias por capacitacion

- Misma experiencia visual que la constancia HTML por capacitacion.
- Agrega selector de capacitacion.
- Incluye control para marcar `DIPLOMAS = true`.
- Para capacitador: solo propias.

### Informacion de sucursales

- Agrupar por `NOMBRE_COMERCIAL -> ESTADO -> MUNICIPIO`.
- Mostrar sucursales con `LABEL`.
- Evitar repetir empresa, estado o municipio cuando ya estan en el grupo.
- Lectura para todos los capacitadores.
- La navegacion principal debe ser por empresa, no por sucursal.
- La ficha de empresa debe mostrar logo, nombre comercial y razon social.
- Los filtros deben incluir pedido, trabajo, PIPC estatal, trabajo municipal, estatus de capacitacion y capacitador.
- El filtro de trabajos es agregativo: si se seleccionan `MUNICIPAL` y `ESTATAL`, se muestran sucursales que contengan cualquiera de los dos trabajos.
- Los demas filtros combinan por interseccion para no mezclar resultados no relacionados.

### Notas y observaciones

- Toda pantalla con notas u observaciones debe permitir crear notas.
- Las notas deben guardarse como hilos.
- Formato visible del hilo: `USUARIO - FECHA: "NOTA"`.
- Los permisos de editar/eliminar deben respetar alcance propio o permiso global.

## Regla de campos calculados

No persistir como fuente de verdad:

- Labels calculados.
- Razon social mostrada desde una referencia.
- Logo calculado.
- Nombres de capacitadores derivados de IDs.
- Nombres de sucursales derivados de IDs.
- Estados como `STATUS CAPACITACION` si se puede calcular desde fecha/status base.

Estos valores se resuelven en backend local para entregar respuestas normalizadas al frontend.

## Contratos tecnicos clave

- `appsheet_local_sync/desarrolloeg-webhook-server.mjs`: recibe Bots y escribe SQLite.
- `src/services/desarrolloegLocalDb.js`: abre la BD local desde el monolito.
- `src/services/localOperationalRepository.js`: normaliza tablas operativas para modulos.
- `src/services/appShellAuditReconciler.js`: compara auditoria y refresca scopes.
- `src/modules/app-shell/appShell.router.js`: expone manifest, refresh, state, webhook y SSE.
- `src/modules/home/portalAccessPolicy.js`: matriz ejecutable de permisos por puesto.
- `src/modules/home/portalAuth.service.js`: autenticacion, sesion y perfil de acceso.
- `src/modules/home/home.router.js`: dashboard, calendario, diplomas, faltantes y pedidos.

## Contratos UI/UX por pantalla integrada

### Calendario

- La tarjeta de capacitacion debe mostrar la sede como dato principal.
- El subtitulo debe reservarse para estatus, horario y capacitadores.
- Los cambios de AppSheet llegan por webhook/local sync y despiertan el dashboard por SSE.
- La tarjeta no debe ocultar capacitaciones por estatus; programadas y finalizadas pueden existir en calendario.

### Capacitaciones

- Deben agruparse visualmente en `Programadas` y `Finalizadas`.
- Debe haber filtros vivos por texto, estatus, capacitador y diplomas.
- Los filtros no deben navegar a otra pagina ni cambiar de dashboard de usuario.
- Las tarjetas deben conservar acciones operativas: ver detalle, editar cuando aplique, crear constancias y controlar diplomas cuando el permiso lo permita.

### Generador de Constancias

- El elemento principal de la pantalla es `Generador de Constancias`.
- El selector de capacitador solo filtra las capacitaciones disponibles en la misma vista.
- Para usuarios con puesto `capacitador`, el capacitador actual queda aplicado por defecto y no se ofrece navegacion global.
- El selector de capacitacion debe precargar sede, fecha, sucursales e iframe de constancias.
- El control de diplomas debe ser SI/NO, mostrar el estado actual y permitir cambiarlo con un click.
- Cambiar diplomas desde el generador no debe quitar la tarjeta ni mandar al usuario a otra vista.

### Empresas y Sucursales

- La pantalla debe sentirse como perfil de empresa, no como una herramienta separada.
- La lista desplegable principal contiene empresas.
- Dentro de la empresa se muestran sucursales agrupadas por estado y municipio.
- Las sucursales se muestran por label, evitando repetir datos ya visibles en los encabezados.
- Si un filtro no puede resolverse por datos locales normalizados, debe quedar documentado como campo virtual pendiente, no consultarse directo a AppSheet en la apertura de pantalla.

## Columnas virtuales locales recomendadas

Estas columnas no deben depender de AppSheet al abrir la pantalla; se deben precalcular en SQLite/local sync o en el repositorio local cuando cambien las tablas base:

- `sucursal.ultimo_pipc_estatal_anio`: ultimo anio de `ESTATALES` para esa sucursal con estatus `EN DRIVE`, `IMPRESO` o `ENTREGADO`.
- `sucursal.ultimo_pipc_estatal_estatus`: estatus del ultimo registro estatal valido.
- `sucursal.ultimo_municipal_anio`: ultimo anio de `MUNICIPALES` para esa sucursal con estatus operativo valido.
- `sucursal.ultimo_municipal_estatus`: estatus del ultimo registro municipal valido.
- `sucursal.estatus_capacitacion_anio_actual`: estado derivado de capacitaciones del anio actual para esa sucursal.
- `sucursal.capacitadores_anio_actual`: capacitadores asociados a capacitaciones del anio actual.
- `sucursal.trabajos_normalizados`: arreglo/string normalizado para filtros agregativos de trabajo.
- `sucursal.pedido_activo`: indicador o ultimo pedido activo cuando aplique.

## Criterio de implementacion por pantalla

1. Leer datos desde SQLite local o cache persistente.
2. Normalizar IDs a labels en backend.
3. Aplicar permisos desde `portalAccessPolicy`.
4. Evitar filtros ocultos no documentados.
5. Despues de escribir en AppSheet, esperar webhook/auditoria o refrescar scope.
6. Notificar al dashboard por SSE.
7. Mantener polling como respaldo, no como mecanismo principal.

## Contrato operativo de Pedidos Casa Ley

Los cuatro estados principales son excluyentes. Enviado, no enviado y sin trabajo son subestados operativos de `No liberado`; no son estados principales adicionales. Ninguno se deduce del texto de `PEDIDOS_LEY.STATUS`.

- Tipo estatal: importe mayor o igual a `$32,967.49`.
- Tipo municipal: importe mayor o igual a `$11,000.00` y menor al umbral estatal.
- El umbral municipal admite variacion anual mediante `PEDIDOS_LEY_MUNICIPAL_THRESHOLD_<ANIO>`; el valor general se configura con `PEDIDOS_LEY_MUNICIPAL_THRESHOLD`.
- La existencia de liberacion se decide exclusivamente contra la tabla local `LIBERACIONES`. Los campos calculados o listas serializadas del pedido no son fuente de verdad.

- `Liberados sin factura`: el pedido aparece en `LIBERACIONES` y su UUID de ClubFactura no aparece en `FACTURAS_EN_LEY`.
- `Sin liberacion enviados`: no existe liberacion y el indicador local `ENVIADO` esta activo.
- `Sin liberacion no enviados` o `Listos para enviar`: no existe liberacion, no se ha enviado y la sucursal tiene el trabajo correspondiente del ano consultado con estatus `EN DRIVE`, `IMPRESO` o `ENTREGADO`.
- `Sin liberacion sin trabajo`: no existe liberacion, no se ha enviado y falta el trabajo correspondiente vigente.
- La disponibilidad de archivos no define si fue enviado; `ENVIADO` define enviado/no enviado y los archivos habilitan la accion operativa.
- `Pagados`: el UUID aparece en `PAGADOS_LEY.UUID` o la liberacion aparece dentro de `PAGADOS_LEY.ASIGNACION`.
- `No pagados`: el UUID existe en `FACTURAS_EN_LEY`, pero no existe pago ni por UUID ni por asignacion de liberacion.
- `Sin pedido`: combinacion sucursal + tipo de trabajo + ano que tiene trabajo vigente y no tiene pedido equivalente.

Cadena de navegacion de datos: `PEDIDOS_LEY.PEDIDO -> CFDIS.PEDIDO -> CFDIS.UUID -> FACTURAS_EN_LEY.FOLIO_UUID -> PAGADOS_LEY.UUID`. La liberacion se cruza adicionalmente con `LIBERACIONES.NUM_PEDIDO -> LIBERACIONES.LIBERACION -> PAGADOS_LEY.ASIGNACION`.

Cada pedido pertenece a un solo estado principal, aplicando la evidencia en este orden:

1. `Pagado`: existe pago por cualquiera de los UUID del pedido o por la liberacion en `PAGADOS_LEY.ASIGNACION`.
2. `No pagado`: uno de sus UUID existe en `FACTURAS_EN_LEY`, pero no existe pago relacionado.
3. `Liberado`: tiene registro en `LIBERACIONES`, pero ninguno de sus UUID aparece en `FACTURAS_EN_LEY`.
4. `No liberado`: no tiene liberacion y tampoco ha avanzado a factura o pago.

Los pedidos `No liberados` se desglosan en un unico subestado:

- `Enviado`: el correo de entrega ya fue enviado.
- `No enviado`: el trabajo correspondiente del anio en curso esta listo y no se ha enviado el correo.
- `Sin trabajo`: falta el trabajo correspondiente vigente.

Un pedido puede tener mas de un CFDI por sustituciones o refacturacion. La relacion se evalua contra todos sus UUID y no solo contra la ultima fila recuperada. Las filas historicas de `PAGADOS_LEY` con UUID malformado se ignoran para evitar falsos pagos.

## Reporte de tiendas Casa Ley

- Es una pantalla integrada del dashboard y usa las sucursales enriquecidas de la base local.
- Solo incluye sucursales Casa Ley configuradas con trabajo municipal o estatal.
- Muestra label, municipio, estado, estatus de capacitacion, capacitador y vigencia anual de ambos trabajos.
- El estatus de PC Estatal se cruza por `SUCURSALES.ID_PC` contra el registro local del ano actual; si no existe, se muestra `PENDIENTE`.
- PC Estatal permanece local y nunca se sincroniza hacia AppSheet.
- Dependencia pendiente: el job de extraccion PC Estatal debe persistir fecha y estatus en la base compartida para sustituir el fallback `PENDIENTE`.

## Regla temporal de capacitaciones

- Fecha anterior a `TODAY()`: `FINALIZADA`.
- Fecha igual o posterior a `TODAY()`: `PROGRAMADA`.
- El backend vuelve a calcular el estado al leer; no confia en un estatus almacenado que pueda quedar vencido.
