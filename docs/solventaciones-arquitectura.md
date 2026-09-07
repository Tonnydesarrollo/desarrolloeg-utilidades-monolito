# Sistema de Proteccion Civil y solventaciones

## Objetivo

La vista `Proteccion Civil` centraliza el seguimiento de los expedientes de PC Estatal. El calendario sigue siendo la pagina principal del portal y el sistema se abre como una pestaña interna en `/dashboard?tab=solventaciones`.

## Fuente de datos

- El indice se consulta desde la tabla persistente local `STATUS SISTEMA PC`.
- `SUCURSAL` enlaza el expediente con la sucursal local; `sucursal_id` conserva el identificador externo de PC Sinaloa.
- La sucursal se enriquece con empresa, razon social, nombre comercial y logo desde las tablas locales `SUCURSALES` y `EMPRESAS`.
- La opinion favorable se lee de `OPINION FAVORABLE`, se acepta solo si apunta por HTTPS a `pcsinaloa.gob.mx` y se muestra en expedientes firmados.
- Las incidencias y evidencias remotas no se descargan al abrir el tablero. Se consultan solamente al solicitar un reporte.

## Flujo de estados

Los valores de origen se normalizan en seis etapas:

1. Creada
2. En captura
3. Revision de campo
4. Visitada
5. Autorizada
6. Firmada

`RECHAZADA` y `SUBSANADA` permanecen como detalle de la etapa Visitada para conservar el estado operativo y permitir preparar el reporte.

## Vistas

- `En proceso`: expedientes del ano seleccionado; inicia con el ano en curso.
- `Historico`: expedientes anteriores agrupados por ano y empresa; inicia con el ano anterior.
- `Pendientes`: expedientes visitados listos para generar reporte individual, por empresa o mediante seleccion multiple.

Todos los grupos expandibles cargan contraidos. Los contadores, empresas y etapas se recalculan con los filtros activos.

## Endpoints

- `GET /dashboard?tab=solventaciones`: entrada integrada al portal.
- `GET /solventaciones/html?embed=1`: tablero ligero usado por la pestaña.
- `GET /solventaciones/api/overview`: resumen AJAX desde SQLite.
- `GET /solventaciones/report`: reporte HTML bajo demanda.
- `GET /solventaciones/pdf`: PDF bajo demanda.

Los reportes aceptan `year`, `razonSocial` y `solicitudIds` separados por coma.

## Rendimiento

- La pantalla inicial entrega solo el shell y carga el resumen mediante `fetch`.
- La seleccion multiple evita preparar reportes que el usuario no solicito.
- Las evidencias se procesan con concurrencia acotada y conservan su orden.
- Las imagenes del PDF se redimensionan a un maximo de `340 x 255` y calidad `34`, sin eliminar evidencias.
- Chromium se reutiliza entre solicitudes y el resultado pesado mantiene una cache corta invalidada cuando cambia la revision de SQLite.

## Contratos de navegacion

- El menu global contiene el grupo `Trabajos`: `Municipales`, `Estatales` y `Sistema de Proteccion Civil`.
- `Municipales` y `Estatales` son vistas operativas independientes que consultan directamente sus tablas persistentes homonimas. No derivan sus datos del campo `TRABAJOS` de las sucursales.
- El estado activo se refleja en la URL y sobrevive a una recarga.
- El modo integrado no crea una segunda barra superior ni un segundo menu.
- Los reportes se abren como documentos independientes y no muestran el enlace `Saltar al contenido principal`.
