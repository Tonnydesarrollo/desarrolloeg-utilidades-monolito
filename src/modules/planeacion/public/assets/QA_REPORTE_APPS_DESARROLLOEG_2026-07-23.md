# Reporte QA - apps.desarrolloeg.com

Fecha de ejecucion: 2026-07-23

Alcance:
- Validacion del portal publico en `https://apps.desarrolloeg.com`
- Revision de modulos visibles desde el monolito local
- Contraste contra el codigo fuente del proyecto
- Revision de uso de CSV locales versus consultas a AppSheet

## Resumen ejecutivo

Estado general: operativo con incidencias.

La plataforma responde y la mayoria de los modulos principales carga correctamente, pero se detectaron:
- una ruta publica rota en WhatsApp Capacitadores
- fallos activos en jobs de fondo
- un posible desfase en la migracion de meses de planeacion
- presencia de CSV locales que parecen ser soporte de migracion, no fuente de verdad del runtime

## Evidencia general de ejecucion

Validaciones confirmadas en produccion:
- `/` responde `200`
- `/health` responde `200`
- `/status` responde `200`
- `/Planeacion-ley/` responde `200`
- `/facturacion/cotizacion/html` responde `200`
- `/contabilidad` responde `200`
- `/CONSTANCIAS/` responde `200`
- `/SUCURSALES-DOCS/` responde `200`
- `/FALTANTES-LEY/` responde `200`
- `/SOLVENTACIONES/html` responde `200`
- `/POLIZA_LEY/` responde `200`
- `/SEPARAR-PIPC/` responde `200`
- `/jobs` responde `200`
- `/jobs/pedidos/manual` responde `200`
- `/whatsapp-capacitadores/health` responde `200`
- `/whatsapp-capacitadores/qr` responde `200`
- `/bolsa-sync/health` responde `200`

Validaciones de seguridad y control:
- Endpoints protegidos de `bolsa-sync` sin secreto responden `401`
- Payloads vacios en endpoints de escritura de Planeacion responden `400`

## Hallazgos

### 1) Ruta base rota en WhatsApp Capacitadores

Severidad: Alta

Descripcion:
- El portal expone la tarjeta de WhatsApp Capacitadores.
- El router esta montado en `/whatsapp-capacitadores`.
- La ruta base `https://apps.desarrolloeg.com/whatsapp-capacitadores` responde `404`.
- El router solo expone `/health`, `/qr` y `/qr.png`.

Impacto:
- El usuario entra desde el portal a una ruta muerta.
- Se rompe la experiencia de navegacion y soporte operativo.

Referencia tecnica:
- [`portalAuth.service.js`](./src/modules/home/portalAuth.service.js)
- [`app.js`](./src/app.js)
- [`whatsappCapacitadores.router.js`](./src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js)

### 2) Fallos activos en jobs de fondo

Severidad: Alta

Descripcion:
- El endpoint `/health` reporto fallos en jobs criticos.
- Se observo un error de login bloqueado en ClubFactura.
- Tambien se reporto un aborto por timeout en `pedidos-native-sync`.

Impacto:
- Las sincronizaciones pueden quedar desactualizadas.
- Hay riesgo operativo en procesos que dependen de jobs automatizados.

Referencia tecnica:
- [`app.js`](./src/app.js)
- [`jobs.router.js`](./src/modules/jobs/jobs.router.js)

### 3) Posible desfase de mes en migracion CSV de Planeacion

Severidad: Media

Descripcion:
- `normalizePlaneacionMonthFromCsv()` suma `+1`.
- `migrate-casaley-csv` usa ese valor al guardar `MES PLANEACION`.
- El CSV local ya contiene `assigned_month`, lo que sugiere que podria ser 1-based.

Impacto:
- Una sucursal puede quedar asignada al mes siguiente del correcto.
- Riesgo de inconsistencias en el calendario de capacitacion.

Referencia tecnica:
- [`appsheet.js`](./src/modules/planeacion/services/appsheet.js)
- [`planeacion.router.js`](./src/modules/planeacion/planeacion.router.js)

### 4) CSV locales probablemente son legado de migracion, no runtime principal

Severidad: Media

Descripcion:
- El flujo de lectura principal de Planeacion consulta AppSheet.
- `readBranches()` y `writeBranches()` existen en `csvStore.js`, pero no aparecieron como parte del flujo runtime principal revisado.
- El CSV local `casaley_stores.csv` se usa en la migracion `migrate-casaley-csv`.

Impacto:
- Puede haber codigo y archivos heredados que confunden mantenimiento.
- Si ya no se usan, aumentan deuda tecnica y ruido operacional.

Referencia tecnica:
- [`csvStore.js`](./src/modules/planeacion/services/csvStore.js)
- [`appsheet.js`](./src/modules/planeacion/services/appsheet.js)
- [`planeacion.router.js`](./src/modules/planeacion/planeacion.router.js)

## Tickets de mejora

### QA-001 - Corregir ruta base de WhatsApp Capacitadores

Tipo: Bug
Prioridad: Alta

Descripcion:
- Crear una landing en `/whatsapp-capacitadores` o redirigir a `/whatsapp-capacitadores/qr`.

Criterio de aceptacion:
- La ruta base no debe responder `404`.
- Debe existir una experiencia clara para entrar al modulo desde el portal.

### QA-002 - Revisar estabilidad de jobs criticos

Tipo: Incidencia operativa
Prioridad: Alta

Descripcion:
- Corregir el login bloqueado de ClubFactura.
- Revisar timeout y reintentos en `pedidos-native-sync`.
- Agregar alertas o monitoreo si no existen.

Criterio de aceptacion:
- El health no debe mostrar errores repetidos en jobs criticos.
- Las sincronizaciones deben terminar sin fallos recurrentes.

### QA-003 - Validar contrato del mes de planeacion

Tipo: Bug potencial
Prioridad: Media

Descripcion:
- Confirmar si el CSV de origen maneja meses 0-based o 1-based.
- Ajustar `normalizePlaneacionMonthFromCsv()` si la conversion es incorrecta.
- Agregar pruebas unitarias para migracion y persistencia de mes.

Criterio de aceptacion:
- Un mes cargado desde CSV debe guardarse en el mismo mes esperado.
- No debe haber desplazamiento de mes en la UI ni en AppSheet.

### QA-004 - Definir si los CSV locales siguen siendo necesarios

Tipo: Deuda tecnica
Prioridad: Media

Descripcion:
- Confirmar si `branches.csv` y `csvStore.js` siguen teniendo uso productivo.
- Si ya no se usan, documentar su obsolescencia o eliminarlos en una limpieza controlada.
- Si siguen siendo necesarios, documentar el flujo exacto y su razon de ser.

Criterio de aceptacion:
- Debe quedar claro si los CSV son fuente activa, respaldo, o artefacto legacy.
- No debe haber ambiguedad entre AppSheet, CSV y posible base de datos futura.

### QA-005 - Documentar la fuente de verdad de Planeacion

Tipo: Mejora documental
Prioridad: Media

Descripcion:
- Explicar que el runtime usa AppSheet como fuente de verdad.
- Documentar que el CSV local se usa como insumo de migracion, no como almacenamiento principal.

Criterio de aceptacion:
- Cualquier persona del equipo puede identificar rapidamente la fuente de verdad actual.

## Revision de CSV locales

Conclusiones de la revision:
- No se encontro evidencia de que Planeacion haya sido migrado a una base de datos local tipo SQLite/Postgres/MySQL.
- El flujo principal consulta AppSheet API en `fetchBranchesFromAppSheet()`.
- Los CSV locales no parecen ser la fuente de verdad del runtime.
- El uso mas claro de CSV local es la migracion desde `casaley_stores.csv`.

Interpretacion:
- `branches.csv` y `csvStore.js` parecen ser soporte o legado.
- El reemplazo real del almacenamiento en runtime no fue una base de datos local, sino AppSheet.

## Recomendaciones

1. Resolver la ruta base de WhatsApp Capacitadores.
2. Corregir y monitorear los jobs de fondo.
3. Validar con negocio la regla de meses de Planeacion.
4. Definir y documentar la vigencia de los CSV locales.
5. Agregar pruebas automatizadas para migraciones y rutas criticas.

## Conclusiones

La aplicacion esta funcional en general, pero aun tiene puntos de friccion operativa y de mantenimiento.
El riesgo mayor esta en:
- navegacion rota en WhatsApp Capacitadores
- jobs con error activo
- posible inconsistencia en migracion de meses

El area de Planeacion usa AppSheet como fuente de verdad operativa.
Los CSV locales se observan como soporte de migracion o legado, no como almacenamiento principal del runtime.
