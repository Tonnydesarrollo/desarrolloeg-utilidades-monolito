# Reporte QA - apps.desarrolloeg.com

Fecha de ejecucion: 2026-07-23

Alcance:
- Validacion del portal publico en `https://apps.desarrolloeg.com`
- Revision de modulos visibles desde el monolito local
- Contraste contra el codigo fuente del proyecto
- Revision de uso de CSV locales versus consultas a AppSheet

## Resumen ejecutivo

Estado general: operativo con incidencias y con evidencia de desalineacion entre el codigo local corregido y la version publicada en productivo.

La plataforma responde y la mayoria de los modulos principales carga correctamente, pero se detectaron:
- una ruta publica rota en WhatsApp Capacitadores
- fallos activos en jobs de fondo
- un posible desfase en la migracion de meses de planeacion
- presencia de CSV locales que parecen ser soporte de migracion, no fuente de verdad del runtime

## Actualizacion de segunda ronda QA

Se ejecuto una segunda validacion sobre productivo despues del plan de solucion.

Resultado resumido:
- El codigo local ya contiene correcciones y las pruebas automatizadas pasan.
- El sitio productivo sigue sin reflejar completamente todas las mejoras.
- Persisten rutas rotas o desfasadas en `jobs` y en la raiz de WhatsApp Capacitadores.
- Hay oportunidades claras de mejora en performance, UX y politicas de caché.

Evidencia de productivo en esta segunda ronda:
- `/whatsapp-capacitadores` sigue respondiendo `404`
- `/jobs/health` responde `404`
- `/jobs/history/facturas-native-sync` responde `404`
- `/facturacion/cotizacion/html` tuvo primera carga lenta
- `/status` tuvo primera carga lenta
- `/SOLVENTACIONES/html` se mantiene por encima de lo ideal en tiempo de respuesta
- `/Planeacion-ley/` responde rapido, pero sus assets se sirven con `no-store`

Validaciones locales posteriores al plan:
- `npm test` paso completo
- `jobs` ya incluye health e historial en el codigo local
- `whatsapp-capacitadores` ya incluye landing local
- `normalizePlaneacionMonthFromCsv()` ya protege contra meses invalidos

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

Validaciones de segunda ronda en productivo:
- `/whatsapp-capacitadores` responde `404`
- `/whatsapp-capacitadores/health` responde `200`
- `/whatsapp-capacitadores/qr` responde `200`
- `/whatsapp-capacitadores/qr.png` responde `404` cuando no hay QR disponible
- `/jobs` responde `200` con JSON
- `/jobs/health` responde `404`
- `/jobs/history/facturas-native-sync` responde `404`
- `/api/branches` responde `200`
- `/api/sync` responde `404`
- `/api/migrate-casaley-csv` responde `404`
- `/bolsa-sync/health` responde `200`

Tiempos de carga observados en segunda ronda:
- `/` aproximadamente 762 ms
- `/health` aproximadamente 137 ms
- `/status` aproximadamente 5.4 s en la primera carga
- `/Planeacion-ley/` aproximadamente 154 ms
- `/jobs` aproximadamente 127 ms
- `/facturacion/cotizacion/html` aproximadamente 20.7 s en la primera carga
- `/SOLVENTACIONES/html` aproximadamente 2.8 s

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

### 5) Desalineacion entre local y productivo

Severidad: Alta

Descripcion:
- El codigo local ya contiene landing de WhatsApp Capacitadores, health e historial de jobs, y validacion del contrato de mes.
- Sin embargo, productivo sigue devolviendo `404` en algunas rutas que ya deberian existir.
- Esto apunta a un problema de despliegue, version publicada o promocion incompleta del release.

Impacto:
- QA y operacion ven comportamientos distintos segun ambiente.
- Se dificulta validar que el plan de solucion quedo realmente activo.

Referencia tecnica:
- [`whatsappCapacitadores.router.js`](./src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js)
- [`jobs.router.js`](./src/modules/jobs/jobs.router.js)
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

### QA-006 - Alinear despliegue entre local y productivo

Tipo: Release / Despliegue
Prioridad: Alta

Descripcion:
- Verificar que el commit o build publicado en produccion incluya la version corregida de WhatsApp Capacitadores, Jobs y Planeacion.
- Confirmar que no existe un artefacto intermedio o build anterior aun sirviendose al publico.

Criterio de aceptacion:
- Las rutas que ya fueron corregidas en local deben comportarse igual en productivo.
- No debe existir desalineacion entre ambiente local y productivo.

### QA-007 - Mejorar tiempos de primera carga en modulos pesados

Tipo: Performance
Prioridad: Alta

Descripcion:
- Optimizar `facturacion/cotizacion/html`, `status` y `SOLVENTACIONES/html`.
- Revisar si el problema es de renderizado, carga de datos o payload excesivo.

Criterio de aceptacion:
- La primera carga debe quedar en rangos razonables para usuario final.
- Las recargas no deben depender de un "second hit" para sentirse rápidas.

### QA-008 - Revisar politica de caché en Planeacion

Tipo: Performance / tecnica
Prioridad: Media

Descripcion:
- Los assets de Planeacion se sirven con `no-store, no-cache`.
- Valorar si los recursos versionados pueden servirse con caché controlado.

Criterio de aceptacion:
- El navegador debe poder reutilizar assets inmutables sin romper la actualizacion del modulo.

### QA-009 - Fortalecer UX de navegacion por modulo

Tipo: UX/UI
Prioridad: Media

Descripcion:
- Homogeneizar las entradas de modulo para que cada uno tenga landing clara o dashboard comprensible.
- Evitar que un usuario final tenga que conocer URLs tecnicas para operar.

Criterio de aceptacion:
- Cada modulo principal debe tener una entrada con acciones claras, estado visible y regreso facil.

### QA-010 - Añadir documentacion operativa visible

Tipo: Documentacion
Prioridad: Media

Descripcion:
- Incluir una guia de rutas y responsabilidades para soporte y operacion.
- Marcar de forma clara que es UI de usuario final, que es health y que es endpoint tecnico.

Criterio de aceptacion:
- El equipo puede navegar el sistema sin depender de conocimiento tribal.

## Revision de CSV locales

Conclusiones de la revision:
- No se encontro evidencia de que Planeacion haya sido migrado a una base de datos local tipo SQLite/Postgres/MySQL.
- El flujo principal consulta AppSheet API en `fetchBranchesFromAppSheet()`.
- Los CSV locales no parecen ser la fuente de verdad del runtime.
- El uso mas claro de CSV local es la migracion desde `casaley_stores.csv`.

Interpretacion:
- `branches.csv` y `csvStore.js` parecen ser soporte o legado.
- El reemplazo real del almacenamiento en runtime no fue una base de datos local, sino AppSheet.

## Revision de performance y UX

Observaciones de segunda ronda:
- `Planeacion` carga rapido y su ruta base esta bien resuelta en productivo.
- `WhatsApp Capacitadores` mejora en el codigo local, pero productivo aun no refleja la landing base.
- `Jobs` necesita una experiencia mas guiada para usuarios operativos.
- `status` y `SOLVENTACIONES` muestran latencias perceptibles en primera carga.
- `facturacion/cotizacion/html` presenta una primera carga muy lenta y es la mayor friccion para usuario final entre las rutas medidas.

Buenas practicas observadas:
- Hay pruebas automatizadas locales para los cambios clave.
- El contrato de mes en Planeacion fue endurecido.
- Se agrego trazabilidad de jobs en codigo local.

Buenas practicas por reforzar:
- Separar claramente vista operativa de API tecnica.
- Reducir politicas de no-cache sobre assets versionados.
- Alinear version publicada con version de rama local.

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

## Conclusión actualizada de segunda ronda

El trabajo de correccion en local fue efectivo, pero el productivo aun muestra síntomas de desalineacion de despliegue y algunos puntos de UX/performance a mejorar.

Prioridades inmediatas:
1. Alinear productivo con el codigo corregido.
2. Resolver la ruta base de WhatsApp Capacitadores.
3. Publicar la experiencia operativa de Jobs.
4. Optimizar los módulos con primera carga lenta.
5. Definir y documentar la vigencia de los CSV locales.
