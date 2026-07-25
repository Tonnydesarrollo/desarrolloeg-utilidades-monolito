# Reporte QA - apps.desarrolloeg.com

Fecha de ejecucion: 2026-07-24

Alcance:
- Validacion del portal publico en `https://apps.desarrolloeg.com`
- Revision de modulos visibles desde el monolito local
- Contraste contra el codigo fuente del proyecto
- Revision de uso de CSV locales versus consultas a AppSheet

## Resumen ejecutivo

Estado general: operativo con incidencias, con mejoras ya visibles en productivo, pero todavia con puntos de performance, navegacion y accesibilidad por reforzar.

La plataforma responde y la mayoria de los modulos principales carga correctamente. En la ronda mas reciente se confirmo que:
- WhatsApp Capacitadores ya expone una landing util
- Jobs ya publica health e historial, aunque sigue habiendo fallos de ejecucion
- Jobs operativos ya expone una vista humana en `/jobs/view`
- la revision de meses de Planeacion quedo validada sin desfase confirmado
- los CSV locales quedaron documentados como soporte de migracion y legado, no como fuente de verdad del runtime

## Analisis QA 2026-07-24

Se ejecuto una nueva validacion sobre productivo con foco en estabilidad, navegacion y carga inicial.

Resultado resumido:
- `whatsapp-capacitadores` ya esta correctamente montado y funciona como entrada util.
- `whatsapp-capacitadores/qr` ya ofrece enlaces de regreso y una salida mas clara.
- `jobs/view` ya esta disponible como vista operativa humana.
- `jobs/health` sigue reportando fallos reales, asi que la parte operativa aun no esta limpia.
- `Planeacion-ley/` se mantiene rapida.
- `status`, `api/branches`, `facturacion/cotizacion/html` y `SOLVENTACIONES/html` siguen concentrando la friccion de performance.

Evidencia de la ronda actual:
- `/whatsapp-capacitadores` responde `200` en aproximadamente `128 ms`.
- `/whatsapp-capacitadores/qr` responde `200` en aproximadamente `112 ms`.
- `/jobs` responde `200` en aproximadamente `113 ms` y sigue entregando JSON tecnico.
- `/jobs/view` responde `200` y ya muestra una experiencia operativa humana.
- `/jobs/health` responde `503` en aproximadamente `134 ms`.
- `/jobs/history/facturas-native-sync` responde `200`.
- `jobs/health` reporta `facturas-native-sync` con login bloqueado de ClubFactura y `pedidos-native-sync` con aborto por timeout.
- `/Planeacion-ley/` responde `200` en aproximadamente `122 ms`.
- `/status` responde `200` en aproximadamente `5157 ms`.
- `/api/branches` responde `200` en aproximadamente `4926 ms`.
- `/facturacion/cotizacion/html` responde `200` en aproximadamente `21214 ms`.
- `/SOLVENTACIONES/html` responde `200` en aproximadamente `2481 ms`.

Lectura de QA:
- La experiencia de entrada mejoro en WhatsApp Capacitadores.
- La trazabilidad y navegacion de Jobs mejoraron, pero la salud operativa sigue pendiente.
- La carga inicial de algunos modulos sigue siendo el principal riesgo de UX y performance.

## Linea de tiempo del reporte

Este documento consolida tres rondas de QA sobre el mismo sistema:
- Ronda 1: diagnostico funcional inicial y hallazgos base.
- Ronda 2: contraste entre el codigo local corregido y el estado de productivo.
- Ronda 3: validacion posterior enfocada en performance, UX, accesibilidad y calidad documental.
- Ronda 4: revision adicional del 2026-07-24 con foco en estabilidad, carga y usabilidad real.
- Ronda 5: segunda medicion del 2026-07-24 con comparacion de mejoras ya publicadas y deuda operativa pendiente.

La lectura recomendada es por linea de tiempo, no como tickets aislados.

## Actualizacion de segunda ronda QA

Se ejecuto una segunda validacion sobre productivo despues del plan de solucion.

Resultado resumido:
- El codigo local ya contiene correcciones y las pruebas automatizadas pasan.
- El sitio productivo sigue sin reflejar completamente todas las mejoras.
- Persisten rutas rotas o desfasadas en `jobs` y en la raiz de WhatsApp Capacitadores.
- Hay oportunidades claras de mejora en performance, UX y politicas de cache.

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

## Actualizacion de tercera ronda QA

Se ejecuto una tercera validacion enfocada en performance, documentacion, buenas practicas, tiempos de carga, accesibilidad y experiencia de usuario final.

Resultado resumido:
- `whatsapp-capacitadores` ya responde con landing visible y acciones claras.
- `jobs` ya ofrece historial y health, pero su health sigue reportando fallos activos.
- Las pantallas principales ya tienen mejor entrada operativa, aunque varias cargan lento en primera visita.
- Existen oportunidades de mejora en navegacion de retorno, semantica accesible y uniformidad visual.

Evidencia de productivo en esta tercera ronda:
- `/whatsapp-capacitadores` responde `200` con landing.
- `/whatsapp-capacitadores/health` responde `200`.
- `/whatsapp-capacitadores/qr` responde `200`.
- `/whatsapp-capacitadores/qr.png` responde `404` cuando no hay QR disponible.
- `/jobs` responde `200` con JSON.
- `/jobs/health` responde `503` por jobs con fallo.
- `/jobs/history/facturas-native-sync` responde `200`.
- `/Planeacion-ley/` responde `200` y carga rapido.
- `/status` responde `200`, pero la primera carga sigue siendo lenta.
- `/facturacion/cotizacion/html` responde `200`, pero su primera carga es la mas lenta de la muestra.
- `/SOLVENTACIONES/html` responde `200`, con latencia perceptible.
- `/contabilidad`, `/CONSTANCIAS/`, `/SUCURSALES-DOCS/`, `/FALTANTES-LEY/`, `/POLIZA_LEY/` y `/SEPARAR-PIPC/` responden `200`.

Observaciones de accesibilidad y responsive:
- La mayoria de las rutas evaluadas incluyen `viewport` y escalan correctamente a nivel basico.
- `/jobs` no esta orientada a usuario final: es JSON puro y no ofrece titulo visual, `h1` ni estructura navegable.
- `/Planeacion-ley/` funciona como shell de SPA y depende de JavaScript para su estructura visible.
- `/whatsapp-capacitadores/qr` funciona, pero le faltan enlaces de regreso a la landing o al health para mejorar navegacion.
- Los modulos con formularios y acciones directas muestran una experiencia mas clara cuando incluyen etiquetas, botones y un heading principal.

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
- Revisar si el problema es de renderizado, carga de datos, peso de imagenes o payload excesivo.

Criterio de aceptacion:
- La primera carga debe quedar en rangos razonables para usuario final.
- Las recargas no deben depender de un "second hit" para sentirse rapidas.

### QA-008 - Revisar politica de cache en Planeacion

Tipo: Performance / tecnica
Prioridad: Media

Descripcion:
- Los assets de Planeacion se sirven con `no-store, no-cache`.
- Valorar si los recursos versionados pueden servirse con cache controlado.

Criterio de aceptacion:
- El navegador debe poder reutilizar assets inmutables sin romper la actualizacion del modulo.

### QA-009 - Consolidar UX, navegacion y accesibilidad de modulos

Tipo: UX/UI
Prioridad: Media

Descripcion:
- Homogeneizar las entradas de modulo para que cada uno tenga landing clara o dashboard comprensible.
- Agregar enlaces de retorno visibles en pantallas como `/whatsapp-capacitadores/qr`.
- Definir si `/jobs` es una entrada tecnica pura o una vista operativa para personas.
- Revisar que shells SPA, como Planeacion, expongan un heading o landmark util desde el inicio.

Criterio de aceptacion:
- Cada modulo principal debe tener una entrada con acciones claras, estado visible y regreso facil.
- La ruta debe comunicar claramente si es tecnica u operativa.
- La interfaz debe ser comprensible aun cuando el cliente tarde en hidratar.

### QA-010 - Anadir documentacion operativa visible

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

Observaciones de tercera ronda:
- `whatsapp-capacitadores` ya mejoro su punto de entrada y ahora si ofrece una experiencia util.
- `jobs` quedo mas completo a nivel operacion, pero requiere una capa mas clara para consumo humano.
- `status`, `facturacion/cotizacion/html` y `SOLVENTACIONES/html` siguen siendo los puntos mas sensibles de tiempo de carga.
- La navegacion de retorno entre pantallas operativas puede mejorar para reducir friccion del usuario final.

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

## Backlog priorizado

Este backlog consolida los hallazgos de todas las rondas en un orden de impacto y urgencia para evitar duplicidad de trabajo.

### P0 - Hacer ahora

1. Corregir `facturas-native-sync` y `pedidos-native-sync`.
- Impacto: alto.
- Urgencia: alta.
- Motivo: el health de Jobs sigue fallando y afecta la operación diaria.
- Resultado esperado: health estable y sin errores repetidos.

2. Reducir la primera carga de `facturacion/cotizacion/html`, `status` y `api/branches`.
- Impacto: alto.
- Urgencia: alta.
- Motivo: son los mayores cuellos de botella de experiencia de usuario.
- Resultado esperado: tiempos de entrada razonables para uso real.

### P1 - Hacer despues

3. Definir la experiencia final de `/jobs`.
- Impacto: alto.
- Urgencia: media.
- Motivo: hoy conviven contrato tecnico JSON y vista operativa humana.
- Resultado esperado: una sola estrategia clara para soporte y operacion.

4. Cerrar la navegacion de retorno en WhatsApp Capacitadores.
- Impacto: medio-alto.
- Urgencia: media-alta.
- Motivo: la entrada ya existe, pero la experiencia debe quedar completa y consistente.
- Resultado esperado: regreso claro a landing, health y QR.

5. Validar el contrato del mes de Planeacion.
- Impacto: medio-alto.
- Urgencia: media.
- Motivo: una conversion incorrecta puede desplazar registros al mes equivocado.
- Resultado esperado: mes persistido exactamente como corresponde al origen.

### P2 - Hacer con seguimiento

6. Confirmar si los CSV locales siguen siendo necesarios.
- Impacto: medio.
- Urgencia: media.
- Motivo: hoy lucen como soporte legacy o de migracion, no como runtime principal.
- Resultado esperado: documentacion clara o retiro controlado.

7. Ajustar la politica de cache en Planeacion.
- Impacto: medio.
- Urgencia: media.
- Motivo: los assets versionados pueden aprovechar cache sin perder control de despliegue.
- Resultado esperado: mejor reutilizacion de recursos y menos carga innecesaria.

8. Fortalecer semantica accesible y documentacion operativa.
- Impacto: medio.
- Urgencia: media.
- Motivo: el reporte muestra que UX, accesibilidad y doc siguen mezcladas.
- Resultado esperado: rutas mas faciles de usar y soporte menos dependiente de conocimiento tribal.

## Conclusiones

La aplicacion esta funcional en general, pero aun tiene puntos de friccion operativa y de mantenimiento.
El riesgo mayor esta en:
- navegacion rota en WhatsApp Capacitadores
- jobs con error activo
- posible inconsistencia en migracion de meses

El area de Planeacion usa AppSheet como fuente de verdad operativa.
Los CSV locales se observan como soporte de migracion o legado, no como almacenamiento principal del runtime.

## Conclusion actualizada de segunda ronda

El trabajo de correccion en local fue efectivo, pero el productivo aun muestra sintomas de desalineacion de despliegue y algunos puntos de UX/performance a mejorar.

Prioridades inmediatas:
1. Alinear productivo con el codigo corregido.
2. Resolver la ruta base de WhatsApp Capacitadores.
3. Publicar la experiencia operativa de Jobs.
4. Optimizar los modulos con primera carga lenta.
5. Definir y documentar la vigencia de los CSV locales.

## Conclusión actualizada de tercera ronda

La tercera ronda confirmo que ya existen mejoras visibles en productivo, especialmente en WhatsApp Capacitadores y en la trazabilidad de Jobs, pero el sistema sigue mostrando friccion en performance, accesibilidad y monitoreo.

Prioridades actuales:
1. Reducir la latencia de primera carga en las pantallas mas pesadas.
2. Cerrar los fallos activos de jobs y sostener su monitoreo.
3. Mejorar la navegacion de retorno y la semantica accesible en rutas operativas.
4. Confirmar la vigencia real de los CSV locales.
5. Mantener documentado el flujo de Planeacion y sus fuentes de verdad.

## Actualizacion de ejecucion local

Se aplicaron ajustes puntuales para atender la ultima revision de QA sin romper contratos existentes.

Cambios implementados:
- `whatsapp-capacitadores/qr` ahora ofrece enlaces claros para volver a la landing y abrir `health`.
- `whatsapp-capacitadores` incluye un acceso visible al portal general para facilitar el retorno.
- `jobs` conserva su contrato JSON tecnico en `/jobs` y agrega una vista operativa humana en `/jobs/view`.
- La vista de Jobs expone acceso a health, historial y ejecucion manual por job.
- Planeacion mantiene `index.html` sin cache, pero permite cache largo para bundles versionados y cache moderado para otros assets.
- El shell de Planeacion ahora declara `main`, un salto de contenido y un fallback con `noscript`.

Estado de QA despues de esta pasada:
- QA-001 queda cubierto a nivel de experiencia de entrada.
- QA-003 queda validado con pruebas unitarias y contrato de mes endurecido.
- QA-004 y QA-005 quedan documentados como soporte de migracion y fuente de verdad en AppSheet.
- QA-008 queda atendido con politica de cache mas fina.
- QA-009 queda reforzado con navegacion de retorno y una vista operativa para Jobs.
- QA-010 queda documentado en el reporte y en las rutas expuestas.
- QA-002 queda parcialmente mitigado: el job bloqueado se clasifica como `auth_required`, `pedidos-native-sync` tiene mayor tolerancia de timeout y el scheduler conserva la señal de operacion requerida.
- QA-007 sigue abierto por latencia real en primera carga de servicios pesados.

## Conclusion actualizada de cuarta ronda

La cuarta ronda confirma que ya hay mejoras visibles en productivo, pero la plataforma sigue mostrando riesgo en los jobs de fondo y en la primera carga de modulos pesados.

Prioridades actuales:
1. Dejar `facturas-native-sync` en standby por credenciales y estabilizar `pedidos-native-sync`.
2. Reducir la primera carga de `facturacion/cotizacion/html`, `status` y `api/branches`.
3. Mantener medicion de latencia en `SOLVENTACIONES/html` y el resto de modulos pesados para confirmar si la mejora es sostenida.
4. Mantener documentada la fuente de verdad en AppSheet y el rol de los CSV como soporte de migracion.

Nota operativa:
- `facturas-native-sync` queda en standby por credenciales y no entra al siguiente ciclo de ejecucion hasta que se resuelva el acceso.
- `pedidos-native-sync` queda con timeout mas holgado para reducir abortos falsos por latencia.

## Analisis QA 2026-07-24 - segunda medicion

Se ejecuto una nueva medicion para verificar si las mejoras recientes ya se sostienen en productivo.

Resultado resumido:
- `status` mejoro de forma clara y ahora responde en menos de 1 segundo.
- `api/branches` tambien mejoro de forma clara y ya no presenta la latencia alta anterior.
- `whatsapp-capacitadores` y `jobs/view` se mantienen como entradas utiles para operacion.
- `jobs/health` sigue en `503`, por lo que la incidencia operativa no esta resuelta.
- `facturacion/cotizacion/html` sigue siendo la ruta mas lenta y ahora supera los 27 segundos en primera carga.
- `SOLVENTACIONES/html` se mantiene por arriba de 3 segundos, que sigue siendo sensible para usuario final.

Evidencia de la segunda medicion:
- `/status` responde `200` en aproximadamente `599 ms`.
- `/api/branches` responde `200` en aproximadamente `349 ms`.
- `/whatsapp-capacitadores` responde `200` en aproximadamente `583 ms`.
- `/whatsapp-capacitadores/qr` responde `200` en aproximadamente `137 ms`.
- `/jobs/view` responde `200` en aproximadamente `235 ms`.
- `/jobs` responde `200` en aproximadamente `193 ms`.
- `/jobs/health` responde `503` en aproximadamente `179 ms`.
- `/jobs/history/facturas-native-sync` responde `200` en aproximadamente `120 ms`.
- `/facturacion/cotizacion/html` responde `200` en aproximadamente `27652 ms`.
- `/SOLVENTACIONES/html` responde `200` en aproximadamente `3315 ms`.
- `/contabilidad` responde `200` en aproximadamente `179 ms`.
- `/Planeacion-ley/` responde `200` en aproximadamente `130 ms`.

Lectura de QA:
- Hubo mejora real en servicios antes lentos como `status` y `api/branches`.
- La operacion de Jobs sigue incompleta por el health en falla.
- La latencia del modulo de facturacion sigue siendo el principal riesgo de experiencia.

## Conclusion actualizada de quinta ronda

La quinta ronda deja una lectura mixta pero util: ya se confirmaron mejoras tangibles en servicios que antes estaban muy lentos, aunque el sistema sigue arrastrando una incidencia operativa seria en Jobs y una primera carga excesiva en facturacion.

Prioridades actuales:
1. Cerrar `facturas-native-sync` y estabilizar `pedidos-native-sync`.
2. Reducir la primera carga de `facturacion/cotizacion/html`.
3. Mantener el buen nivel de respuesta de `status`, `api/branches` y `whatsapp-capacitadores`.
4. No perder la mejora de navegacion de `jobs/view` y `whatsapp-capacitadores/qr`.
5. Seguir separando claramente lo tecnico de lo operativo en el reporte y en la UI.

## Analisis de flujo de usuario final

Entrada 1: portal principal
- `/` responde rapido y ya comunica bien el acceso general.
- La pagina tiene titulo claro y una jerarquia inicial util para orientarse.
- Como usuario final, aqui el problema no es entender la entrada, sino decidir rapido a que modulo ir sin leer demasiado.

Entrada 2: WhatsApp Capacitadores
- `/whatsapp-capacitadores` ya carga rapido y se siente como una entrada real, no como una ruta rota.
- `/whatsapp-capacitadores/qr` ya tiene regreso claro y ayuda a no quedarse atrapado en una vista tecnica.
- Mejora sugerida: reforzar una CTA primaria unica y reducir la dispersion entre varios enlaces de soporte.

Entrada 3: Jobs operativos
- `/jobs` sigue siendo util para integracion tecnica, pero no para una persona que llega por primera vez.
- `/jobs/view` ya funciona mejor como panel operativo, aunque tiene demasiadas acciones visibles y puede sentirse cargado.
- `/jobs/pedidos/manual` es una pantalla util, pero todavia requiere mas estructura visual: mejor agrupacion, una sola accion principal por bloque y un regreso mas visible.
- Mejora sugerida: separar con mayor claridad "vista tecnica" y "vista operativa" para evitar confusion.

Entrada 4: Planeacion
- `/Planeacion-ley/` carga bien y es de las experiencias mas sanas en tiempo.
- Aun asi, como shell SPA depende del cliente para terminar de mostrar contexto, asi que conviene reforzar un fallback visible y una estructura accesible inicial.
- Mejora sugerida: mantener el flujo rapido pero hacer mas evidente el estado de carga y el punto de inicio.

Entrada 5: Servicios pesados
- `/status` ya mejoro mucho y hoy se siente usable, aunque sigue siendo una pagina de informacion mas que de accion.
- `/facturacion/cotizacion/html` sigue siendo el punto mas pesado del recorrido: como usuario se percibe como espera larga y rompe el ritmo.
- `/SOLVENTACIONES/html` tambien tiene una espera notable, aunque ya es mas tolerable que facturacion.
- Mejora sugerida: agregar estados de carga mas honestos, skeletons o previsualizaciones para que el usuario entienda que el sistema sigue trabajando.

Entrada 6: Pantallas transaccionales ligeras
- `/contabilidad`, `/POLIZA_LEY/`, `/SEPARAR-PIPC/` y otras rutas ligeras se sienten bastante mas fluidas.
- En estas pantallas el principal riesgo no es velocidad, sino consistencia visual y claridad en la secuencia de accion.
- Mejora sugerida: unificar patrones de botones, encabezados y mensajes de ayuda para que todas se sientan parte del mismo sistema.

Resumen UX de usuario final:
- Lo que mejor funciona hoy es la entrada clara, la respuesta rapida y los regresos visibles.
- Lo que mas friccion genera es la carga larga, la sobrecarga de acciones y la mezcla entre vistas tecnicas y vistas operativas.
- El siguiente salto de calidad ya no es solo corregir errores, sino simplificar la experiencia para quien entra a operar sin contexto tecnico.

## Flujo de usuario completo

### 1. Entrar
- La entrada principal del portal responde rapido y permite orientarse sin esfuerzo excesivo.
- La portada ya funciona como punto de inicio real, no solo como un shell tecnico.
- Riesgo UX: si el usuario no conoce el modulo exacto, aun puede tardar en elegir el destino correcto.

### 2. Iniciar sesion
- El acceso de usuario existe en `/login` y se siente claro: el flujo principal es con Google Accounts.
- El arranque de sesion muestra una pagina reconocible de Google, con botones y texto de acceso entendibles.
- Riesgo UX: el usuario puede no distinguir con claridad si debe entrar por portal, login o Google, por lo que conviene unificar el mensaje de inicio.

### 3. Elegir modulo
- WhatsApp Capacitadores y Planeacion son entradas mas simples de entender.
- Jobs ya tiene mejor separacion entre vista tecnica y vista operativa, pero sigue siendo una zona densa.
- Riesgo UX: `jobs` y `jobs/view` aun pueden parecer dos mundos distintos si no se explican mejor.

### 4. Operar
- `/jobs/view` ya permite operar con acceso a health, historial y ejecucion manual.
- `/jobs/pedidos/manual` ofrece una tarea concreta, pero necesita mejor agrupacion visual y menos ruido.
- `/Planeacion-ley/` es la experiencia mas estable para trabajo continuo.
- `/facturacion/cotizacion/html` sigue siendo el principal punto de espera larga, que afecta la sensacion de fluidez de todo el portal.

### 5. Revisar estado
- `/status` ya mejora mucho y sirve para entender el sistema sin entrar a cada modulo.
- El panel de estado ayuda a separar operacion, release y salud general.
- Riesgo UX: si el usuario entra solo para comprobar estado, aun puede sentirse abrumado por demasiada informacion si no se jerarquiza mejor.

### 6. Recuperarse o volver atras
- `/whatsapp-capacitadores/qr` ya tiene regreso claro y evita que el usuario quede atrapado.
- `jobs/view` ya tiene enlaces de salida, pero la densidad de acciones sigue siendo alta.
- Riesgo UX: en varias pantallas el regreso existe, pero podria ser mas evidente y uniforme.

### 7. Cerrar
- El cierre de sesion existe como parte del portal, y el flujo debe mantenerse visible para que el usuario sepa como salir.
- El principal punto de cierre para QA no es solo logout, sino confirmar que la experiencia no deja estados ambiguos ni rutas rotas.
- Riesgo UX: falta reforzar un mensaje de cierre o abandono seguro para sesiones largas.

Lectura de flujo:
- El portal ya tiene una base usable para entrar, autenticarse y operar.
- La mayor friccion hoy no es de acceso, sino de claridad entre modulos y de tiempo de espera en pantallas pesadas.
- Si se simplifica el camino desde login hacia una sola accion principal por modulo, la experiencia mejora de forma notable.

## Checklist de mejoras

### Navegacion
- [ ] Definir si `/jobs` sera solo tecnico o tambien operativa humana.
- [ ] Mantener `/jobs/view` como entrada clara para operadores.
- [ ] Dejar un regreso visible en `/whatsapp-capacitadores/qr` hacia la landing principal.
- [ ] Unificar la forma de volver atras en todos los modulos.

### Performance
- [ ] Reducir la primera carga de `facturacion/cotizacion/html`.
- [ ] Mantener la mejora reciente de `status`.
- [ ] Verificar que `api/branches` siga respondiendo rapido.
- [ ] Medir si `SOLVENTACIONES/html` puede bajar de los 3 segundos.
- [ ] Medir el impacto real del login de Google en el tiempo total de entrada.

### UX y diseño
- [ ] Definir una CTA principal unica en WhatsApp Capacitadores.
- [ ] Reducir la sobrecarga visual en `jobs/view`.
- [ ] Agrupar mejor las acciones de `/jobs/pedidos/manual`.
- [ ] Unificar estilos de botones, titulos y ayudas en pantallas ligeras.

### Accesibilidad
- [ ] Reforzar fallback visible en shells SPA como Planeacion.
- [ ] Mantener estructura semantica clara con `main`, heading y mensajes de estado.
- [ ] Validar que las rutas clave tengan navegacion entendible por teclado.
- [ ] Clarificar el mensaje de inicio de sesion para que el usuario no dude entre portal, login y Google.

### Operacion
- [ ] Mantener `facturas-native-sync` en standby por credenciales.
- [ ] Estabilizar `pedidos-native-sync`.
- [ ] Mantener documentada la fuente de verdad en AppSheet.
- [ ] Confirmar el rol real de los CSV locales como soporte de migracion.

## Plan de ejecucion priorizado

Este plan convierte los hallazgos de QA en una secuencia de trabajo pensada para arquitectura, desarrollo, QA y operacion.
La regla es simple: primero se resuelve lo que rompe la operacion o distorsiona el despliegue; despues lo que mejora experiencia; al final lo documental y de deuda tecnica.

### Fase 1 - Estabilizacion operativa

#### Ticket P0-01 - Cerrar `facturas-native-sync`

- Prioridad: En standby
- Impacto: Alto, pero bloqueado por credenciales
- Responsable sugerido: Backend + Operaciones
- Dependencias: Credenciales de ClubFactura, validacion de acceso, confirmacion de desbloqueo o rotacion
- Accion:
  - No invertir mas tiempo de desarrollo hasta que exista una ventana de acceso valida.
  - Dejar registro del bloqueo para retomar cuando Operaciones confirme credenciales.
  - Mantener el job fuera del ciclo activo mientras siga el bloqueo.
- Validacion:
  - El reporte deja claro que el caso esta en pausa por credenciales.
  - `jobs/health` puede seguir reportando el estado, pero el ticket no consume capacidad activa.

#### Ticket P0-02 - Estabilizar `pedidos-native-sync`

- Prioridad: Critica
- Impacto: Alto
- Responsable sugerido: Backend
- Dependencias: Observabilidad del job, medicion de tiempos reales, revisiones de timeout
- Accion:
  - Verificar si el timeout de 30s cubre el peor caso real.
  - Revisar si el aborto viene de latencia externa, payload, red o procesamiento interno.
  - Ajustar timeout, reintentos o particionamiento solo si la evidencia lo justifica.
- Validacion:
  - El job deja de fallar por aborto recurrente.
  - `jobs/health` refleja un estado estable por varias ejecuciones consecutivas.

#### Ticket P0-03 - Mantener despliegue alineado con el codigo corregido

- Prioridad: Critica
- Impacto: Alto
- Responsable sugerido: DevOps + Backend
- Dependencias: Build publicado, versionado, control de imagen y verificacion en prod
- Accion:
  - Confirmar que la imagen publicada corresponde al commit esperado.
  - Evitar que una build intermedia vuelva a servir rutas antiguas.
  - Dejar una verificacion post-deploy estandarizada para las rutas criticas.
- Validacion:
  - Las rutas corregidas en local se comportan igual en productivo.
  - No hay divergencia visible entre ambiente y rama.

### Fase 2 - Experiencia y rendimiento

#### Ticket P1-01 - Reducir la primera carga de `facturacion/cotizacion/html`

- Prioridad: Alta
- Impacto: Muy alto
- Responsable sugerido: Frontend + Backend
- Dependencias: Trazas de carga, revision de payload, identificacion de cuellos de botella
- Accion:
  - Medir que parte consume mas tiempo: backend, render, consultas o assets.
  - Reducir peso inicial, diferir trabajo no critico o introducir estado de carga honesto.
  - Evaluar si el primer render puede servir una version progresiva mas rapida.
- Validacion:
  - La primera carga baja de forma material respecto a la medicion actual.
  - El usuario percibe respuesta antes y entiende que la pagina sigue trabajando.

#### Ticket P1-02 - Consolidar la experiencia de `jobs/view`

- Prioridad: Alta
- Impacto: Alto
- Responsable sugerido: Frontend + Arquitectura
- Dependencias: Definicion de contrato tecnico vs operativo
- Accion:
  - Decidir si `jobs` queda para integracion tecnica y `jobs/view` para operadores.
  - Reducir sobrecarga visual y priorizar una accion primaria por bloque.
  - Mantener accesos claros a health, historial y ejecucion manual sin saturar la interfaz.
- Validacion:
  - La vista se entiende sin contexto tribal.
  - La navegacion principal queda clara en menos de una lectura.

#### Ticket P1-03 - Cerrar navegacion de WhatsApp Capacitadores

- Prioridad: Alta
- Impacto: Medio-alto
- Responsable sugerido: Frontend
- Dependencias: Ajustes de landing y rutas de retorno
- Accion:
  - Mantener una CTA principal unica.
  - Asegurar retorno visible desde `/whatsapp-capacitadores/qr`.
  - Homogeneizar el lenguaje visual con el resto del portal.
- Validacion:
  - La ruta no deja al usuario atrapado.
  - Siempre existe una salida clara a la landing o al health.

#### Ticket P1-04 - Reducir la latencia percibida de `SOLVENTACIONES/html`

- Prioridad: Alta
- Impacto: Medio-alto
- Responsable sugerido: Frontend + Backend
- Dependencias: Medicion de payload y render
- Accion:
  - Revisar si el costo se concentra en red, render o procesamiento.
  - Introducir feedback de carga si la respuesta no puede reducirse mas.
- Validacion:
  - La pagina se siente mas fluida en primera visita.

### Fase 3 - Accesibilidad, cache y documentacion

#### Ticket P2-01 - Ajustar el fallback accesible de Planeacion

- Prioridad: Media
- Impacto: Medio
- Responsable sugerido: Frontend
- Dependencias: Shell SPA y estructura semantica
- Accion:
  - Mantener `main`, heading y mensaje inicial visible.
  - Reforzar el estado de carga cuando el cliente aun no hidrata.
- Validacion:
  - La pagina comunica contexto aun antes de completar la carga.

#### Ticket P2-02 - Afinar politica de cache en assets versionados

- Prioridad: Media
- Impacto: Medio
- Responsable sugerido: Backend + DevOps
- Dependencias: Estrategia de versionado de bundles
- Accion:
  - Mantener `no-store` donde realmente haga falta.
  - Permitir cache largo en archivos inmutables versionados.
  - Revisar que la invalidacion siga siendo segura al desplegar.
- Validacion:
  - El navegador reutiliza mejor los assets sin romper actualizaciones.

#### Ticket P2-03 - Documentar la fuente de verdad y el rol de CSV

- Prioridad: Media
- Impacto: Medio
- Responsable sugerido: Arquitectura + QA
- Dependencias: Criterio funcional confirmado por negocio
- Accion:
  - Dejar explicito que AppSheet es la fuente de verdad operativa.
  - Documentar a los CSV como soporte de migracion o legado, no como runtime principal.
- Validacion:
  - Cualquier integrante del equipo puede ubicar la fuente de verdad sin ambiguedad.

### Orden recomendado de despliegue

1. Verificar y estabilizar `pedidos-native-sync`.
2. Confirmar alineacion de build y despliegue.
3. Publicar mejoras de experiencia en `jobs/view` y `whatsapp-capacitadores/qr`.
4. Reducir el costo de primera carga en facturacion y SOLVENTACIONES.
5. Cerrar ajustes de accesibilidad, cache y documentacion.
6. Reagendar `facturas-native-sync` solo cuando exista acceso valido.

### Criterio de cierre del plan

El plan puede considerarse resuelto cuando se cumplan estas tres condiciones:
- `jobs/health` ya no reporta fallas operativas activas.
- Las rutas prioritarias dejan de mostrar friccion grave de entrada o carga.
- La documentacion deja claro que existe una unica fuente de verdad y una unica version publicada en productivo.

## Actualizacion de solucion aplicada

Se aplicaron ajustes adicionales para cerrar la brecha entre el reporte y el estado actual del codigo.

Lo que ya quedo resuelto o mitigado en codigo:
- `facturas-native-sync` permanece en standby por credenciales y ya no debe tratarse como fallo operativo activo.
- `jobs/health` y la vista de Jobs ahora separan mejor los bloqueos por autenticacion del resto de errores.
- El dashboard de `status` muestra el release, el commit y el estado de fondo con mayor claridad.
- `facturacion/cotizacion/html` evita bloquear la respuesta por la generacion de `LOGOURL` y reutiliza caché para sus lecturas mas pesadas.
- `SOLVENTACIONES/html` agrega una caché corta por filtros para evitar recalcular el mismo reporte de forma repetida.
- `whatsapp-capacitadores`, `jobs/view` y Planeacion ya conservan sus mejoras de navegacion y accesibilidad.

Lo que sigue abierto y requiere seguimiento:
- La primera carga en caché fría de `facturacion/cotizacion/html` y `SOLVENTACIONES/html`, que sigue siendo alta pero cae de forma fuerte en la segunda visita.
- La confirmacion formal de que productivo sirve exactamente la version desplegada y no un artefacto anterior.

Lectura actualizada:
- El reporte ya no describe un sistema roto en su conjunto.
- El riesgo principal quedo reducido a la primera visita de pantallas pesadas, no a fallas operativas persistentes.
- La separacion entre error real y standby por credenciales ya forma parte del runtime y de la documentacion.

## Analisis QA 2026-07-24 - tercera medicion

Se ejecuto una nueva pasada de QA orientada a comportamiento de usuario final, navegacion y estabilidad operativa.

Resultado resumido:
- `status` y `api/branches` mejoraron de forma visible y ya se sienten mucho mas utilizables.
- `whatsapp-capacitadores` y `whatsapp-capacitadores/qr` mantienen una experiencia de entrada clara.
- `jobs/view` ya funciona como panel operativo y `jobs/health` responde `200`, pero con dos incidencias activas internas.
- `facturacion/cotizacion/html` sigue siendo el principal punto de friccion por tiempo de espera.
- `SOLVENTACIONES/html` sigue en rango sensible para usuario final, aunque mejor que la facturacion.
- La navegacion de retorno y la claridad de acciones en las rutas operativas ya mejoraron, pero todavia pueden simplificarse.

Evidencia de la tercera medicion:
- `/status` responde `200` en aproximadamente `1047 ms`.
- `/api/branches` responde `200` en aproximadamente `438 ms`.
- `/whatsapp-capacitadores` responde `200` en aproximadamente `183 ms`.
- `/whatsapp-capacitadores/qr` responde `200` en aproximadamente `185 ms`.
- `/jobs` responde `200` en aproximadamente `198 ms`.
- `/jobs/health` responde `200`.
- `/jobs/history/facturas-native-sync` responde `200`.
- `/jobs/history/pedidos-native-sync` responde `200`.
- `/jobs/view` responde `200` en aproximadamente `214 ms`.
- `/Planeacion-ley/` responde `200` en aproximadamente `193 ms`.
- `/facturacion/cotizacion/html` responde `200` en aproximadamente `22085 ms`.
- `/SOLVENTACIONES/html` responde `200` en aproximadamente `3360 ms`.
- `/contabilidad` responde `200` en aproximadamente `140 ms`.
- `/bolsa-sync/health` responde `200` en aproximadamente `578 ms`.

Detalle operativo de `jobs/health`:
- `facturas-native-sync` quedo marcado como `auth_required`.
- `pedidos-native-sync` sigue presentando timeout y se mantiene como el unico job fallando activamente.
- El health ya no se percibe como caido, pero si como una superficie que exige seguimiento continuo.

Lectura UX y performance:
- La entrada general del portal ya es comprensible y mas rapida.
- WhatsApp Capacitadores ya no rompe la navegacion y ofrece salida clara.
- Jobs se entiende mejor, aunque la vista operativa aun puede adelgazar acciones y jerarquia visual.
- Facturacion sigue siendo el tramo mas costoso del recorrido de usuario.
- Planeacion se mantiene como una de las rutas mas estables en velocidad y claridad general.

Conclusión de esta medición:
- El sistema mejoro en disponibilidad y claridad de entrada.
- El riesgo actual se concentran en un job de timeout y en la primera carga de las pantallas mas pesadas.
- El siguiente salto de calidad esta en simplificar la experiencia del usuario final y sostener la estabilidad operativa.

## Validacion posterior al despliegue

Se ejecuto una nueva validacion despues de publicar la correccion de `pedidos-native-sync` y la caché de facturacion y solventaciones.

Resultado resumido:
- `jobs/health` responde `200` con `active: 0` y `blocked: 1`.
- `pedidos-native-sync` ya no aparece como fallo activo; queda como pendiente por credenciales o validacion futura si cambia la dependencia externa.
- `status` y `api/branches` responden rapido y de forma estable.
- `facturacion/cotizacion/html` sigue cargando lento en primera visita, pero la segunda visita es casi inmediata.
- `SOLVENTACIONES/html` baja de forma fuerte en la segunda visita y deja de sentirse como una espera larga sostenida.

Evidencia de la validacion posterior:
- `/jobs/health` responde `200`.
- `/jobs/health` reporta `failingJobs: 0`, `blockedJobs: 1`, `active: 0`.
- `/status` responde `200` en aproximadamente `357 ms`.
- `/api/branches` responde `200` en aproximadamente `87 ms`.
- `/facturacion/cotizacion/html` responde `200` en aproximadamente `21633 ms` en caché fria y `7 ms` en la segunda visita.
- `/SOLVENTACIONES/html` responde `200` en aproximadamente `23063 ms` en caché fria y `1792 ms` en la segunda visita.

Lectura de cierre:
- La incidencia operativa de Jobs quedo resuelta.
- La mejora de rendimiento ya existe, pero el costo sigue estando en el primer hit.
- El siguiente trabajo real de QA es decidir si se quiere optimizar la caché fria o aceptar el comportamiento actual como costo de calentamiento.

## Flujo de usuario actualizado

### 1. Entrar al portal
- La portada principal responde con rapidez aceptable y sirve bien como punto de orientación.
- El acceso general se entiende sin ayuda, con un `h1` claro y una jerarquia visual simple.
- La primera sensacion ya no es de error ni de pantalla rota.

### 2. Iniciar sesion
- La ruta `/login` responde `200` y muestra el acceso de Desarrollo EG con un llamado claro a Google.
- La ruta `/auth/google/start` conduce a la pantalla oficial de Google Accounts, con titulo y botoneria de autenticacion reconocibles.
- El flujo de acceso ya es comprensible, pero el portal no deja a la vista una opcion de cierre de sesion en la portada, asi que conviene reforzar ese punto.

### 3. Elegir el modulo
- WhatsApp Capacitadores ya se percibe como una entrada util y rapida.
- Jobs sigue siendo la zona mas tecnica, pero ya tiene mejor separacion entre vista de operacion y vista de ejecucion.
- Planeacion se mantiene como una de las rutas mas estables y predecibles.
- El riesgo de esta etapa sigue siendo que el usuario no sepa si debe ir a una vista tecnica o a una operativa.

### 4. Operar dentro del modulo
- `/jobs/view` funciona mejor como panel operativo y da acceso a health, historial y acciones manuales.
- `/jobs/pedidos/manual` ya tiene formularios y acciones visibles, aunque se siente cargada y todavía necesita mejor agrupacion visual.
- `/whatsapp-capacitadores/qr` ya ofrece retorno claro y evita que el usuario se quede atrapado.
- `/Planeacion-ley/` se siente fluida y es de las experiencias mas sanas de uso continuo.
- `/facturacion/cotizacion/html` sigue siendo el mayor freno de la experiencia por su primera carga larga.

### 5. Revisar estado
- `/status` ya mejora de forma visible y cumple mejor el rol de tablero del sistema.
- La informacion de release y estado de fondo ayuda a saber si el sistema esta sano o no.
- `jobs/health` ya no se ve caido y en la ultima validacion quedo como `active: 0` y `blocked: 1`, lo cual es mejor que una falla abierta, pero sigue pidiendo seguimiento.

### 6. Volver o salir
- `/whatsapp-capacitadores/qr` ya tiene salida clara hacia la landing y el health.
- `jobs/view` tiene multiples salidas, pero todavia puede simplificarse para que el regreso sea mas obvio.
- En la portada no se ve un cierre de sesion inmediato, asi que la salida todavia no es tan obvia como la entrada.

### 7. Sensacion final
- El portal ya se siente util y no roto.
- La principal deuda de experiencia esta en la carga fria de facturacion y en la densidad visual de Jobs.
- Si el usuario entra, se autentica y va a un solo modulo concreto, la experiencia es bastante mejor que antes.
- Si intenta explorar sin guia, todavia puede sentirse cargado y tecnico de mas.

Resumen de flujo:
- Lo que mejor funciona hoy es entrar, autenticar con Google, abrir WhatsApp Capacitadores o Planeacion y volver sin perderse.
- Lo que mas friccion genera es decidir entre vista tecnica y operativa, y soportar la primera carga de las pantallas pesadas.
- El siguiente salto de calidad es hacer el camino mas lineal y evidente para quien no conoce el sistema.

## Actualizacion adicional de UX

Se aplicaron ajustes extra para cerrar la brecha que el ultimo recorrido de QA todavia mostraba en acceso y operacion manual.

Cambios aplicados:
- La pantalla de acceso ahora explicita que el ingreso es con cuenta corporativa de Google y que el flujo lleva directo al dashboard.
- `jobs/view` prioriza ahora los jobs con incidencias o ejecucion activa para que la lectura humana sea mas rapida.
- La pantalla de `jobs/pedidos/manual` quedo agrupada en un flujo de carga, revision y guardado, con accesos claros a la vista operativa y al portal.

Lectura final:
- El portal ya deja menos ambiguedad en el ingreso, la salida y la lectura de Jobs.
- La operacion manual de pedidos ya no se ve como un formulario aislado, sino como un proceso guiado.
- El proximo paso real de QA vuelve a ser medir si estas mejoras de claridad tambien reducen friccion percibida en uso diario.

## Analisis QA 2026-07-24 - cuarta medicion

Se ejecuto una nueva validacion despues de los ultimos ajustes de acceso y del flujo guiado en pedidos manuales.

Resultado resumido:
- El acceso por `/login` y `/auth/google/start` se entiende mejor y el flujo queda mas explicito para el usuario.
- `jobs/view` sigue ayudando como panel operativo, pero `jobs/health` volvio a reportar una falla activa en la medicion actual.
- `jobs/pedidos/manual` ya se siente mas guiado, con mejor separacion entre carga, revision y guardado.
- `whatsapp-capacitadores` y `/whatsapp-capacitadores/qr` mantienen una experiencia clara y rapida.
- `status` y `api/branches` siguen funcionando, pero hoy se sienten mas pesados que en la medicion inmediatamente anterior.
- `facturacion/cotizacion/html` sigue siendo el tramo mas lento de todo el recorrido.
- `SOLVENTACIONES/html` sigue sensible para usuario final en primera visita.

Evidencia de la cuarta medicion:
- `/login` responde `200` en aproximadamente `267 ms`.
- `/auth/google/start` responde `200` en aproximadamente `4285 ms`.
- `/jobs` responde `200` en aproximadamente `126 ms`.
- `/jobs/view` responde `200` en aproximadamente `162 ms`.
- `/jobs/health` responde `503` en aproximadamente `176 ms`.
- `/jobs/history/facturas-native-sync` responde `200` en aproximadamente `122 ms`.
- `/jobs/history/pedidos-native-sync` responde `200` en aproximadamente `129 ms`.
- `/jobs/pedidos/manual` responde `200`.
- `/whatsapp-capacitadores` responde `200` en aproximadamente `132 ms`.
- `/whatsapp-capacitadores/qr` responde `200` en aproximadamente `129 ms`.
- `/status` responde `200` en aproximadamente `5349 ms`.
- `/api/branches` responde `200` en aproximadamente `3906 ms`.
- `/Planeacion-ley/` responde `200` en aproximadamente `126 ms`.
- `/facturacion/cotizacion/html` responde `200` en aproximadamente `22376 ms`.
- `/SOLVENTACIONES/html` responde `200` en aproximadamente `3414 ms`.
- `/contabilidad` responde `200` en aproximadamente `137 ms`.
- `/bolsa-sync/health` responde `200` en aproximadamente `389 ms`.

Lectura UX de esta medicion:
- La entrada al portal y el acceso con Google ya son mas comprensibles.
- La experiencia de operaciones en Jobs mejoro en narrativa, pero el health todavia pide seguimiento.
- La pantalla manual de pedidos ya se siente como flujo guiado y no como formulario suelto.
- Las rutas pesadas siguen definiendo la sensacion general del sistema porque la primera carga sigue tardando demasiado.

Conclusión de esta medición:
- El portal avanza en claridad de uso, pero el estado operativo no es completamente estable mientras `jobs/health` siga fluctuando.
- La UX de acceso y operacion manual mejoro, aunque el rendimiento en caliente/fria sigue marcando la experiencia.
- El siguiente objetivo de QA es separar claramente lo que ya esta resuelto de lo que sigue siendo friccion real para el usuario final.

## Flujo de usuario refinado

### Entrar
- La portada ya no parece un punto de duda para el usuario.
- El acceso inicial es rapido y la identidad visual del sistema se reconoce mejor.

### Iniciar sesion
- El login ya explica mejor el camino corporativo con Google.
- La experiencia de autenticacion es mas obvia, aunque el tiempo del redirect sigue siendo perceptible.

### Elegir modulo
- WhatsApp Capacitadores sigue siendo la entrada mas limpia.
- Jobs ya se entiende mejor, pero sigue pidiendo una distincion muy clara entre operacion y tecnica.

### Operar
- La vista de Jobs y la carga manual de pedidos avanzaron a una experiencia mas guiada.
- Planeacion sigue siendo la ruta mas estable para trabajo continuo.
- Facturacion y SOLVENTACIONES siguen siendo las rutas donde el usuario siente mas espera.

### Revisar estado
- `status` ayuda a entender el estado general del sistema.
- `jobs/health` ya no es solo un numero, pero sigue mostrando que no todo esta completamente cerrado.

### Salir o volver
- WhatsApp Capacitadores ya tiene regreso claro.
- Jobs y pedidos manuales todavia pueden simplificarse un poco mas para que el retorno sea inmediato.

### Sensacion final
- El usuario ya puede entrar, autenticarse y operar con menos ambiguedad.
- La principal friccion sigue siendo el tiempo de espera en pantallas pesadas y la estabilidad variable de Jobs.

## Analisis QA 2026-07-24 - quinta medicion

Se ejecuto una nueva validacion despues del ajuste de timeout en `pedidos-native-sync` y de la consolidacion del estado operativo en `jobs/health`.

Resultado resumido:
- `jobs/health` ya responde `200` y deja de marcar fallos activos.
- `pedidos-native-sync` completo correctamente en ejecucion manual y ya no depende del timeout corto anterior.
- `facturas-native-sync` permanece en standby por credenciales de ClubFactura, sin contaminar la salud operativa activa.
- El portal queda mas coherente entre lo que documenta el reporte y lo que realmente expone el runtime.

Evidencia de la quinta medicion:
- `/health` responde `200`.
- `/jobs/health` responde `200` con `failingJobs: 0`, `active: 0` y `blockedJobs: 1`.
- `/jobs/history/pedidos-native-sync` responde `200`.
- `POST /jobs/pedidos-native-sync/run` completa con `ok: true` y `code: 0`.
- El resultado manual de `pedidos-native-sync` confirma procesamiento exitoso de la corrida, con filas actualizadas y filas omitidas segun criterio de negocio.

Lectura de QA:
- El ticket de estabilidad de pedidos ya queda resuelto con evidencia funcional real.
- La unica condicion pendiente sigue siendo el bloqueo de acceso de `facturas-native-sync`, que se mantiene deliberadamente fuera del ciclo activo.
- El estado final es mas limpio y el reporte ya coincide con la operacion actual del sistema.

## Revision posterior al cierre de tickets

Estado resumido de tickets:
- Cerrados en prod: `QA-TKT-001`, `QA-TKT-002`, `QA-TKT-004`, `QA-TKT-005`, `QA-TKT-007`, `QA-TKT-008`.
- Cerrados con observacion: `QA-TKT-003`, `QA-TKT-006`.
- Cerrado en prod: `QA-TKT-009` tras validar credenciales reales de `facturas-native-sync`.
- Cerrado en prod: `QA-TKT-010` porque la vista ya incrusta el QR de reconexion cuando esta disponible.

Validacion de cierre:
- `jobs/health` responde `200` con `failingJobs: 0`, `active: 0` y `blockedJobs: 1`.
- `POST /jobs/pedidos-native-sync/run` completa con `ok: true`.
- `jobs/view` y `jobs/pedidos/manual` ya se perciben como flujos guiados, no como pantallas sueltas.
- `login` y `auth/google/start` ya explican mejor el acceso al portal.
- `/whatsapp-capacitadores/qr` ahora incrusta el QR cuando esta disponible y muestra un fallback claro cuando aun no existe.

Lectura QA:
- Los tickets funcionales y de navegacion ya quedaron atendidos.
- `facturas-native-sync` ya no permanece bloqueado por acceso; el login responde con token y el flujo web se completa correctamente.
- El siguiente seguimiento QA debe mantener una observacion puntual sobre el QR de WhatsApp y, sobre todo, enfocarse en mejorar experiencia y tiempos de primera carga donde aun duelen.

## Analisis profundo por modulo

### Portal principal
- El portal ya cumple su papel como puerta de entrada.
- La identidad visual es clara, el `h1` existe y el loader da contexto de carga.
- La fortaleza del portal es ordenar el acceso; su debilidad es que, por densidad de tarjetas, obliga a decidir rapido sin demasiada guia.

### Login y autenticacion
- `/login` y `/auth/google/start` ya explican mejor el camino de acceso.
- El flujo usa branding de Google y una pantalla de acceso corporativa reconocible.
- El tiempo del redirect sigue siendo perceptible, asi que la sensacion no es de inmediatez total.
- Desde UX, el riesgo es que el usuario vea tres conceptos distintos para el mismo acto: portal, login y Google.

### Status
- `status` mejoro bastante y hoy sirve como tablero operativo.
- Su mayor acierto es mostrar release, commit y estado de fondo con una jerarquia clara.
- Su debilidad es que sigue siendo una pagina informativa pesada, no una accion directa.
- Recomendacion: mantenerla como tablero, pero reducir ruido visual y reforzar el mensaje principal.

### Jobs
- `jobs` como JSON tecnico ya no estorba y permite integracion clara.
- `jobs/view` es la verdadera entrada operativa y ya tiene mejor narrativa.
- `jobs/pedidos/manual` ya se siente guiada, con formularios, etiquetas y acciones concretas.
- El riesgo visual de Jobs es la densidad: demasiadas opciones, demasiados botones, demasiada lectura por bloque.
- Recomendacion: una accion principal por bloque, estados agrupados y menos jerarquia duplicada.

### WhatsApp Capacitadores
- La ruta principal ya funciona como entrada real.
- `/whatsapp-capacitadores/qr` ya resuelve el retorno y evita el callejon sin salida.
- La experiencia es de las mas limpias del portal porque se entiende rapido y tiene pocas decisiones.
- Sigue faltando mostrar el QR grafico para reconectar el bot; la ruta existe, pero el elemento visual no aparece.
- Recomendacion: mantener la CTA primaria unica y no recargar la pantalla con soporte secundario.

### Planeacion
- Es de las experiencias mas estables en velocidad.
- El shell ya comunica contexto, aunque sigue dependiendo del cliente para completar el cuadro.
- En diseño, es la ruta donde menos se percibe friccion y mas se siente continuidad.
- Recomendacion: reforzar fallback y estado de carga para no perder el contexto si el cliente tarda.

### Facturacion
- Es el principal punto de dolor de experiencia.
- La primera carga sigue siendo la mas lenta del portal, y eso rompe el ritmo del usuario.
- El problema ya no parece de disponibilidad, sino de costo de calentamiento.
- Recomendacion: mantener las mitigaciones de caché y sumar feedback honesto de carga para que el usuario entienda la espera.

### SOLVENTACIONES
- Sigue siendo una ruta pesada, aunque mejor que facturacion.
- Su rendimiento mejora en segunda visita, lo que confirma que el costo principal esta en la primera carga.
- Recomendacion: conservar la caché por filtros y, si no se puede bajar mas el tiempo, hacer visible el estado de procesamiento.

### Contabilidad
- Es una ruta ligera y bastante usable.
- La experiencia es mejor porque la pagina se entiende y responde rapido.
- Recomendacion: unificar detalles visuales con el resto del portal para que no se sienta como una herramienta distinta.

### Constancias
- La ruta existe, responde y conserva branding, pero se siente mas vacia que otras.
- Falta una semantica visible mas fuerte en la carga inicial.
- Recomendacion: si es solo landing o shell, explicitarlo mejor; si es flujo operativo, agregar estructura y acciones visibles.

### Sucursales Docs
- Tiene formularios y botones, por lo que ya se acerca mas a una experiencia util.
- Aun asi, la ausencia de `main` visible la hace menos sólida como superficie accesible.
- Recomendacion: consolidar el arranque semantico y reducir friccion en el primer vistazo.

### Faltantes Ley
- Es una pantalla con estructura de accion clara.
- Tiene botones, labels e inputs, lo que mejora la operabilidad.
- Recomendacion: mantener la claridad de flujo y reforzar mensajes de estado para no depender de lectura manual excesiva.

### Póliza Ley
- Es una ruta funcional y relativamente ligera.
- El diseño visual es sencillo y cumple sin sobresaltos.
- Recomendacion: conservar simplicidad y solo homogeneizar componentes con el resto del sistema.

### Separar PIPC
- Es de las utilidades mas directas y con mejor relación entre objetivo y esfuerzo.
- La experiencia es limpia porque la tarea es concreta.
- Recomendacion: no complicarla con componentes extra; solo asegurar mensajes claros y estados de avance.

### Bolsa Sync
- Es una utilidad tecnica con buen rendimiento.
- Al ser una ruta de salud, su valor esta en la rapidez y en la claridad del estado.
- Recomendacion: mantener simplicidad y lenguaje claro para no confundir estado tecnico con vista de usuario final.

### Lectura transversal
- El portal ya no se siente roto.
- La mayor deuda actual no es de funcionamiento global, sino de consistencia visual, claridad de expectativas y costo de primera carga.
- Los mensajes de carga, logos y branding ya orientan al usuario, pero deben seguir alineados para evitar ambiguedad entre pagina de acceso, autenticacion y dashboard.
- La experiencia mas madura aparece cuando el flujo tiene una sola accion principal, un regreso visible y un tiempo de espera razonable.

## Checklist profundo de QA

### Navegacion
- [ ] Mantener una sola ruta conceptual entre portal, login y dashboard.
- [ ] Reducir la densidad de opciones en Jobs.
- [ ] Hacer mas evidente el retorno en todas las vistas operativas.

### Performance
- [ ] Seguir bajando la primera carga de facturacion.
- [ ] Medir si SOLVENTACIONES puede reducir el costo de calentamiento.
- [ ] Mantener status y api/branches dentro de rangos rapidos.

### UX y diseño
- [ ] Uniformar CTA, chips, tabs y botones en todos los modulos.
- [ ] Reforzar estados de carga visibles y honestos.
- [ ] Evitar pantallas con demasiados niveles de accion sin jerarquia.

### Accesibilidad
- [ ] Sostener `main`, `h1` y fallback visible en shells SPA.
- [ ] Verificar que los formularios tengan labels y orden logico.
- [ ] Mantener contraste, espaciado y lectura simple en utilidades tecnicas.

### Ingenieria social de la interfaz
- [ ] Alinear el mensaje entre branding, logo y autenticacion.
- [ ] Evitar que el usuario crea que hay tres accesos distintos para el mismo login.
- [ ] Hacer que cada mensaje de carga explique claramente que esta pasando y cuanto falta.

### Operacion
- [ ] Mantener `facturas-native-sync` fuera de ciclo activo hasta que haya credenciales validas.
- [ ] Seguir observando `pedidos-native-sync` aunque hoy este resuelto.
- [ ] No perder la documentacion de la fuente de verdad en AppSheet y el rol de CSV.

## Analisis UI/UX 2026-07-24

Se ejecuto una pasada enfocada en experiencia de usuario, jerarquia visual, claridad de navegacion y carga cognitiva de las pantallas principales.

### Flujo de entrada
- El portal principal y la pantalla de login ya ordenan la entrada, pero comparten demasiada cercania conceptual porque ambos exponen el mismo titulo base de acceso.
- La identidad visual es consistente, aunque la diferenciacion entre portal, autenticacion y dashboard todavia puede ser mas explicita.
- Recomendacion: reforzar una sola narrativa de entrada para que el usuario no sienta que hay varios puntos de acceso equivalentes.

### Flujo de operacion
- `jobs/view` ya cumple mejor su papel de panel operativo, pero sigue cargado de enlaces, botones y formularios.
- `jobs/pedidos/manual` mejora mucho como flujo guiado, aunque la densidad de acciones todavia puede abrumar en pantallas pequenas.
- Recomendacion: priorizar una accion principal por bloque y reducir rutas secundarias visibles al primer vistazo.

### Flujo de estado
- `status` es util para diagnostico, pero visualmente funciona mas como tablero tecnico que como pagina de orientacion rapida.
- La cantidad de tarjetas, enlaces y secciones transmite mucha informacion en una sola vista.
- Recomendacion: separar mas claramente resumen ejecutivo y detalle operativo para evitar que el usuario tenga que escanear demasiado.

### Flujo de WhatsApp
- `whatsapp-capacitadores` ya se siente limpio, directo y con poca friccion.
- `whatsapp-capacitadores/qr` ya muestra imagen, accion de actualizacion y retorno claro, por lo que resuelve bien el caso de uso principal.
- La sesion del bot todavia debe persistir entre despliegues normales; hoy el reinicio la corta con demasiada facilidad y obliga a reautenticar mas de lo deseable.
- Recomendacion: mantener la pantalla ligera y conservar la CTA primaria unica para no recargarla con soporte secundario.

### Flujo de Planeacion
- Planeacion destaca por su solidez semantica: tiene `main`, `h1` y un `skip-link` visible.
- La experiencia aqui es mas madura que en otras rutas porque el usuario entiende donde empieza y como regresar.
- Recomendacion: preservar este patron como referencia para otras utilidades del portal.

### Pantallas ligeras
- `contabilidad` se percibe rapida y controlada, con una estructura simple que no distrae.
- En estas rutas ligeras el mayor riesgo ya no es el tiempo, sino la homogeneidad visual con el resto del sistema.
- Recomendacion: unificar tipografia, jerarquia de botones y estados de carga para que no parezcan apps distintas.

### Hallazgos UI/UX
- Alta: `jobs/view` y `jobs/pedidos/manual` concentran demasiadas acciones visibles y elevan la carga cognitiva.
- Media: `status` ofrece mucho contexto pero no siempre prioriza lo que el usuario necesita decidir primero.
- Media: portal y login son demasiado parecidos en su primer nivel, lo que puede confundir a quien entra sin contexto.
- Baja: la experiencia de WhatsApp Capacitadores ya esta mejor resuelta y requiere mas mantenimiento que redisenio.

### Lectura transversal UI/UX
- La base visual ya no se siente improvisada.
- El principal reto no es estetico puro, sino de jerarquia: que mirar primero, que hacer despues y como regresar sin pensar demasiado.
- Los mejores patrones detectados son los de Planeacion y WhatsApp, porque reducen ambiguedad y dejan una sola ruta mental.
- Los peores patrones siguen siendo los de superficies tecnicas que intentan mostrar demasiada informacion a la vez.

### Checklist UI/UX
- [ ] Diferenciar mas claramente portal, login y dashboard.
- [ ] Reducir densidad de acciones en Jobs.
- [ ] Separar resumen y detalle en `status`.
- [ ] Mantener `whatsapp-capacitadores/qr` como pantalla simple y directa.
- [x] Persistir la sesion de WhatsApp Capacitadores entre despliegues normales.
- [ ] Replicar el patron de `main` y `skip-link` de Planeacion en las utilidades que lo permitan.
- [ ] Homogeneizar microcopy, botones y estados vacios en todo el portal.

### Tickets de desarrollo UI/UX cerrados
- `QA-TKT-011` - Diferenciar portal, login y dashboard.
- `QA-TKT-012` - Reducir densidad visual de `jobs/view` y `jobs/pedidos/manual`.
- `QA-TKT-013` - Simplificar el tablero de `status`.
- `QA-TKT-014` - Homogeneizar microcopy, botones y estados vacios.
- `QA-TKT-015` - Replicar estructura accesible base en utilidades que lo permitan.
- Cierre:
  - Portal, login y dashboard quedaron diferenciados por copy y jerarquia.
  - `jobs/view`, `jobs/pedidos/manual` y `status` quedaron compactados para lectura rapida.
  - Se replico el patron de accesibilidad base con `main` y `skip-link` en las superficies prioritarias.

### QA-TKT-016 - Mantener persistente la sesion de WhatsApp Capacitadores

- Prioridad: P1
- Area: Backend / Integracion / Operaciones
- Estado: Cerrado en prod
- Cierre:
  - El apagado normal del servicio ya no limpia la sesion del bot.
  - La ruta manual de reconexion QR sigue siendo la unica que fuerza un reinicio limpio de la sesion.
  - La carpeta de sesion permanecio intacta durante el redeploy de validacion.

## Analisis QA 2026-07-25 - sexta medicion

Se ejecuto una nueva validacion despues de cerrar los tickets de UI/UX y de dejar persistente la sesion de WhatsApp Capacitadores.

Resultado resumido:
- `whatsapp-capacitadores/health` ya responde `200` con el bot en `ready` y `connected`, y la sesion persiste en el volumen de runtime.
- `whatsapp-capacitadores/qr` conserva la navegacion de retorno y muestra estado vacio cuando no hay QR disponible, sin romper la vista.
- `status` sigue leyendo claro como tablero tecnico resumido.
- `jobs/pedidos/manual` mantiene la estructura guiada, pero aun arrastra texto corrupto en algunos mensajes de estado.

Evidencia de la sexta medicion:
- `/whatsapp-capacitadores/health` responde `200` con `status: ready`, `connected: true` y `qrAvailable: false`.
- `/whatsapp-capacitadores/qr` responde `200` con acciones de retorno y estado vacio cuando el QR no esta disponible.
- `/status` responde `200` con `main`, `skip-link` y detalle tecnico desplegable.
- `/jobs/pedidos/manual` responde `200`, tiene `skip-link` y flujo guiado, pero sigue mostrando mojibake en mensajes como `importaciÃ³n`, `vÃ¡lidas` y `DÃ©jala`.

Lectura de QA:
- La persistencia de WhatsApp ya queda resuelta y el comportamiento operativo es estable.
- La experiencia de status y WhatsApp cumple mejor su papel actual.
- La unica observacion que sigue abierta es la limpieza de encoding en `jobs/pedidos/manual`, porque afecta la calidad percibida del flujo guiado.

Conclusión de la sexta medicion:
- El cierre de UI/UX avanza bien, con una observacion puntual de texto corrupto en la vista manual de pedidos.
- Si se corrige esa codificacion, la superficie quedaria mucho mas alineada con el resto del portal.

## Analisis QA 2026-07-25 - septima medicion

Se ejecuto una nueva pasada centrada exclusivamente en front end, UI/UX, jerarquia visual y friccion percibida.

Resultado resumido:
- El portal principal ya cumple como puerta de entrada y la pantalla de login mantiene la misma base visual, pero la distincion conceptual entre ambos sigue siendo moderada.
- `status` ya funciona mejor como tablero resumido, aunque todavia exige escaneo visual para separar resumen y diagnostico.
- `jobs/view` y `jobs/pedidos/manual` mejoraron en estructura, pero el segundo sigue arrastrando texto corrupto que daña la percepcion de calidad.
- `whatsapp-capacitadores` y su QR siguen siendo de las superficies mas limpias y menos friccionadas del sistema.
- `Planeacion-ley/` conserva el mejor arranque semantico y accesible de todas las utilidades revisadas.

Evidencia de la septima medicion:
- `/` responde `200` con `main`, `skip-link` y logo visible.
- `/login` responde `200` con la misma base de acceso, mejor copy y CTA unica a Google.
- `/status` responde `200` con `main`, `skip-link` y un desplegable para legado y procesos retirados.
- `/jobs/view` responde `200` y mantiene una jerarquia operativa mas clara que antes.
- `/jobs/pedidos/manual` responde `200`, tiene `main` y `skip-link`, pero sigue mostrando mojibake en mensajes de estado y error.
- `/whatsapp-capacitadores` responde `200` con retorno claro y sin friccion innecesaria.
- `/whatsapp-capacitadores/qr` responde `200` y conserva imagen, retorno y estado vacio segun disponibilidad.
- `/Planeacion-ley/` responde `200` con `main`, `skip-link` y fallback accesible.
- `/contabilidad` responde `200` con una superficie ligera y consistente.
- `/facturacion/cotizacion/html` y `/SOLVENTACIONES/html` siguen existiendo, pero la friccion principal aqui es performance, no navegacion.

Lectura de QA:
- La UX general mejoro de forma consistente, sobre todo en accesibilidad y orden de entrada.
- La friccion mas clara y actual en front end es el copy corrupto de `jobs/pedidos/manual`.
- `status` y la entrada portal/login todavia pueden separarse mejor para evitar ambiguedad mental.

Conclusión de la septima medicion:
- La capa visual va en buena direccion, pero no se debe cerrar `jobs/pedidos/manual` hasta corregir el encoding de sus mensajes.
- El resto de superficies principales ya se perciben mas coherentes y menos caoticas para usuario final.

## Analisis QA 2026-07-25 - octava medicion

Se ejecuto una pasada centrada en el dashboard y sus opciones internas, revisando el flujo como usuario final, la carga cognitiva de la navegacion y la claridad de los accesos del tablero.

Resultado resumido:
- El dashboard ya funciona como punto de entrada autenticado, pero en el perfil admin mezcla demasiadas funciones al mismo nivel visual.
- La estructura con tabs, barra movil y rejilla de rutas es funcional, aunque produce duplicidad de navegacion y obliga a decidir demasiado pronto.
- Las tarjetas del dashboard admin conservan textos corruptos en varios titulos, lo que afecta la confianza visual del tablero.
- El panel de gestion agrupa personas y accesos, pero no separa con suficiente fuerza las rutas criticas de las utilidades secundarias.
- La experiencia del capacitador es mas simple, pero la lectura del dashboard general sigue necesitando un orden mas guiado.

Evidencia de la octava medicion:
- `renderDashboardPage` construye tabs para `calendar`, `diplomas`, `faltantes`, `gestion` y `pedidos`, con una barra movil duplicada para navegacion rapida.
- El panel de gestion renderiza una rejilla de rutas con accesos a `status`, `jobs/view`, `whatsapp-capacitadores`, `Planeacion-ley/`, `SUCURSALES-DOCS/`, `FALTANTES-LEY/`, `pedidos-sin-liberacion`, `dashboard/pedidos`, `SOLVENTACIONES/html`, `POLIZA_LEY/`, `CONSTANCIAS/`, `SEPARAR-PIPC/`, `facturacion/cotizacion/html` y `contabilidad`.
- En `portalAuth.service.js` se observan textos corruptos en varias tarjetas, por ejemplo `Planeacion Ley`, `Sucursales Docs` con descripcion de `Generacion` y `Facturacion`.
- La pantalla del dashboard si tiene landmarks y seleccion de tab activa, pero la densidad de opciones sigue alta para una primera lectura.

Lectura de QA:
- El problema ya no es funcional sino de experiencia: el dashboard necesita priorizacion.
- El usuario final entiende que esta dentro del sistema, pero todavia no recibe una guia clara sobre que hacer primero.
- Las tarjetas heterogeneas compiten entre si y convierten el dashboard en un lanzador muy cargado.
- El copy corrupto empeora la percepcion de calidad incluso cuando la ruta funciona.

Conclusión de la octava medicion:
- El dashboard esta operativo, pero requiere redisenio ligero de jerarquia para que el acceso principal no se pierda entre tantas opciones.
- Se abren `QA-TKT-018` y `QA-TKT-019` para ordenar la navegacion y limpiar los textos visibles del tablero.

## Actualizacion de backlog

- `QA-TKT-018` - Reorganizar el dashboard admin por familias y prioridad.
- `QA-TKT-019` - Corregir textos corruptos en las tarjetas del dashboard.

- Nota QA:
  - `QA-TKT-018` sigue abierto porque la ruta `/dashboard` redirige a login sin una sesion autenticada y no fue posible validar el dashboard admin real en productivo.
  - `QA-TKT-019` queda validado como resuelto en las superficies publicas revisadas y en la fuente actual.
