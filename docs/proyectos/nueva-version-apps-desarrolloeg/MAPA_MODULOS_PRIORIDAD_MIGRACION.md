# Mapa de modulos y prioridad de migracion

Fecha: 2026-08-19

Base:
- [Plan de nueva version de `apps.desarrolloeg.com`](./PLAN_NUEVA_VERSION_APPS_DESARROLLOEG.md)
- [Arquitectura alternativa AppSheet + cache backend](./ARQUITECTURA_APP_CACHE_BACKEND.md)

Objetivo:
Definir el orden recomendado para analizar, refactorizar y migrar cada parte del sistema actual hacia la nueva version, sin romper la operacion productiva.

---

## 1. Criterio de priorizacion

La prioridad de cada modulo se decide por estos factores:

- Impacto en el usuario final.
- Riesgo operativo.
- Frecuencia de uso.
- Acoplamiento con otros modulos.
- Dificultad de mantenimiento actual.
- Probabilidad de romper algo si se toca tarde.

Escala usada:

- `P0`: critico, primero.
- `P1`: alto, siguiente ola.
- `P2`: medio, importante pero no bloqueante.
- `P3`: bajo, puede esperar.

---

## 2. Mapa ejecutivo

| Modulo | Prioridad | Motivo | Estrategia |
|---|---:|---|---|
| AppShell / Cache backend | P0 | Define la nueva entrada, el contrato AJAX y la cache central | Exponer manifest, shell y capas de datos |
| Portal / Home | P0 | Es la puerta de entrada de todo el sistema | Unificar layout, rutas, auth y ambiente |
| Dashboard / Status | P0 | Da visibilidad operativa y puede arrastrar links malos | Hacerlo ambiente-aware y sin enlaces duros |
| Configuracion y arranque | P0 | Define QA vs prod y evita fugas entre ambientes | Centralizar env vars, cookies, redirects y health |
| Jobs / Syncs | P0 | Afecta datos, tiempos y soporte operativo | Clasificar jobs, agregar observabilidad y control |
| Planeacion | P1 | Es amplio, sensible y ya tiene mucho backlog | Separar dominio, UI, integracion y sincronizacion |
| Facturacion | P1 | Alto valor y primera carga pesada | Aislar servicios, optimizar render y cache |
| Contabilidad | P1 | Integracion delicada con dependencia externa | Encapsular cliente y formalizar contrato |
| WhatsApp Capacitadores | P1 | Experiencia de soporte visible | Crear landing clara, health y QR |
| Faltantes Ley / Poliza Ley / Pedidos Ley | P2 | Tienen valor operativo pero pueden migrar en lote | Unificar contrato de vistas y APIs |
| Constancias v2 | P2 | Ya tiene identidad propia y puede evolucionar aparte | Mantener autonomia y evaluar extraccion futura |
| Modulos auxiliares operativos | P2 | Utiles pero heterogeneos | Estandarizar navegacion, errores y permisos |
| Bolsa Sync | P2 | Integracion puntual | Encapsular y observar bien |
| Sucursales Docs | P3 | Funcionalidad de apoyo | Mantener estable con minima intervencion |
| Separar PIPC | P3 | Alcance acotado | Refactor solo si entra en la ola de UX |
| Solventaciones | P3 | Utilidad especifica | Normalizar cuando toque limpiar front compartido |

---

## 3. Detalle por modulo

### 3.1 AppShell / Cache backend

Ubicacion:

- [`src/modules/app-shell/appShell.router.js`](../../../../src/modules/app-shell/appShell.router.js)
- [`src/services/appShellManifest.js`](../../../../src/services/appShellManifest.js)

Problemas que resuelve:

- La nueva experiencia necesita un punto de entrada unico.
- El frontend no debe recalentar datos por usuario.
- El backend debe exponer capas de cache y un mapa de modulos estable.

Prioridad:

- `P0`

Que hacer:

- Mantener el manifest JSON como contrato base.
- Servir shell inicial por backend.
- Exponer prioridades, grupos y capas de datos.

Pruebas:

- `GET /shell` responde HTML util.
- `GET /shell/manifest` responde JSON valido.
- `GET /api/app-shell/manifest` funciona como alias para AJAX.

### 3.2 Portal / Home

Ubicacion:

- [`src/modules/home/home.router.js`](../../../../src/modules/home/home.router.js)
- [`src/modules/home/portalAuth.service.js`](../../../../src/modules/home/portalAuth.service.js)
- [`src/modules/home/portalPath.js`](../../../../src/modules/home/portalPath.js)

Problemas actuales:

- La entrada depende mucho de convenciones de ruta.
- Hay riesgo de mezclar configuracion entre QA y prod.
- La experiencia de navegacion no siempre deja claro el estado del sistema.

Prioridad:

- `P0`

Que hacer:

- Definir un portal unico por ambiente.
- Separar cookies, callbacks y redirects.
- Consolidar identidad visual y navegacion.
- Integrarse con el shell comun y la cache backend.

Pruebas:

- Login correcto.
- Sesion aislada entre ambientes.
- Links internos siempre apuntan al mismo ambiente.

### 3.3 Dashboard / Status

Ubicacion:

- [`src/modules/dashboard/dashboard.router.js`](../../../../src/modules/dashboard/dashboard.router.js)
- [`src/modules/dashboard/dashboard.service.js`](../../../../src/modules/dashboard/dashboard.service.js)

Problemas actuales:

- Riesgo de enlaces duros a prod.
- Puede mezclar estado tecnico con accesos de usuario.

Prioridad:

- `P0`

Que hacer:

- Convertirlo en panel de salud y version.
- Mostrar ambiente, release y estado de jobs.
- Resolver URLs desde configuracion.
- Leer el manifest del shell y reflejar estado real del backend.

Pruebas:

- QA muestra solo enlaces QA.
- Prod muestra solo enlaces prod.
- Health responde con metadata consistente.

### 3.4 Configuracion y arranque

Ubicacion:

- [`src/config/env.js`](../../../../src/config/env.js)
- [`src/app.js`](../../../../src/app.js)
- [`src/server.js`](../../../../src/server.js)
- [`docker-compose.yml`](../../../../docker-compose.yml)

Problemas actuales:

- Si la configuracion no queda estandarizada, la nueva version heredara ambiguedad.

Prioridad:

- `P0`

Que hacer:

- Formalizar `APP_ENVIRONMENT`.
- Separar puertos, cookies y callbacks.
- Dejar QA y prod con runtime totalmente independiente.
- Asegurar que el shell pueda leer runtime, release y cluster desde un contrato unico.

Pruebas:

- Boot correcto en QA.
- Boot correcto en prod.
- `health` declara ambiente real.

### 3.5 Jobs / Syncs

Ubicacion:

- [`src/modules/jobs/jobs.router.js`](../../../../src/modules/jobs/jobs.router.js)
- [`src/modules/jobs/services/`](../../../../src/modules/jobs/services/)
- [`src/modules/jobs/native/`](../../../../src/modules/jobs/native/)
- [`src/services/backgroundServices.js`](../../../../src/services/backgroundServices.js)

Problemas actuales:

- Alto riesgo porque toca integraciones y persistencia.
- Los fallos suelen ser silenciosos o tardios.
- No todos los jobs tienen el mismo nivel de criticidad.

Prioridad:

- `P0`

Que hacer:

- Inventariar jobs.
- Clasificar criticidad.
- Estandarizar reintentos, timeouts y logs.
- Crear panel de salud de jobs.
- Convertir el backend cache en un consumidor natural de los jobs.

Pruebas:

- Corridas manuales controladas.
- Falla visible con mensaje util.
- Health de jobs confiable.

### 3.6 Planeacion

Ubicacion:

- [`src/modules/planeacion/planeacion.router.js`](../../../../src/modules/planeacion/planeacion.router.js)
- [`src/modules/planeacion/services/`](../../../../src/modules/planeacion/services/)
- [`src/modules/planeacion/public/`](../../../../src/modules/planeacion/public/)

Problemas actuales:

- Es grande, con muchos artefactos y mucha logica acumulada.
- Tiene dependencia de AppSheet, CSV, frontend y reglas operativas.

Prioridad:

- `P1`

Que hacer:

- Separar dominio, UI e integraciones.
- Reducir peso de CSV como estado principal.
- Migrarla sobre shell nuevo y consumo AJAX.

Pruebas:

- Busquedas y flujos principales.
- Sincronizacion y exportacion.
- Compatibilidad con AppSheet.

### 3.7 Facturacion

Ubicacion:

- [`src/modules/facturacion/facturacion.router.js`](../../../../src/modules/facturacion/facturacion.router.js)
- [`src/modules/facturacion/services/`](../../../../src/modules/facturacion/services/)
- [`src/modules/facturacion/views/`](../../../../src/modules/facturacion/views/)
- [`src/modules/facturacion/utils/`](../../../../src/modules/facturacion/utils/)

Problemas actuales:

- Primera carga costosa.
- Mezcla de utilidades, vistas e integraciones.

Prioridad:

- `P1`

Que hacer:

- Aislar el motor de construccion de HTML/PDF.
- Cachear lo repetitivo.
- Limpiar helpers y rutas.

Pruebas:

- Primera carga aceptable.
- Salidas correctas.
- Sin romper flujo de cotizacion.

### 3.8 Contabilidad

Ubicacion:

- [`src/modules/contabilidad/contabilidad.router.js`](../../../../src/modules/contabilidad/contabilidad.router.js)
- [`src/modules/contabilidad/contabilidad.service.js`](../../../../src/modules/contabilidad/contabilidad.service.js)
- [`src/modules/contabilidad/contabilidad.client.js`](../../../../src/modules/contabilidad/contabilidad.client.js)

Problemas actuales:

- Puede quedar acoplado a un cliente externo sin buena barrera.

Prioridad:

- `P1`

Que hacer:

- Encapsular API externa.
- Registrar errores y respuestas.
- No dejar reglas de negocio en el router.
- Exponer solo lo minimo necesario para el shell nuevo.

Pruebas:

- Llamadas exitosas.
- Manejo de error externo.

### 3.9 WhatsApp Capacitadores

Ubicacion:

- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js)
- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js)

Problemas actuales:

- La experiencia base no debe sentirse como ruta suelta o tecnica.

Prioridad:

- `P1`

Que hacer:

- Landing clara.
- Acceso a QR.
- Health y estado visible.
- Vincularlo al nuevo shell y no a una pantalla tecnica suelta.

Pruebas:

- Ruta base no responde 404.
- QR accesible.
- Estado entendible.

### 3.10 Faltantes Ley / Poliza Ley / Pedidos Ley

Incluye:

- [`src/modules/faltantes-ley/`](../../../../src/modules/faltantes-ley/)
- [`src/modules/poliza-ley/`](../../../../src/modules/poliza-ley/)
- [`src/modules/pedidos-ley/`](../../../../src/modules/pedidos-ley/)

Problemas actuales:

- Tienen valor operativo pero contratos dispares.

Prioridad:

- `P2`

Que hacer:

- Unificar layout y feedback.
- Normalizar errores.
- Alinear rutas y permisos.

Pruebas:

- Smoke test por modulo.
- Verificacion de rutas publicas.
- Confirmacion de datos visibles.

### 3.11 Constancias v2

Ubicacion:

- [`src/modules/constancias-v2/constanciasV2.router.js`](../../../../src/modules/constancias-v2/constanciasV2.router.js)
- [`src/modules/constancias-v2/public/`](../../../../src/modules/constancias-v2/public/)

Problemas actuales:

- Si crece sin orden puede convertirse en mini-monolito dentro del monolito.

Prioridad:

- `P2`

Que hacer:

- Mantener su identidad propia.
- Definir si se queda integrada o se extrae mas adelante.
- Reutilizar el shell comun si se reescribe su portada.

Pruebas:

- Carga correcta.
- Assets correctos.
- Navegacion estable.

### 3.12 Modulos auxiliares operativos

Incluye:

- [`src/modules/separar-pipc/`](../../../../src/modules/separar-pipc/)
- [`src/modules/solventaciones/`](../../../../src/modules/solventaciones/)
- [`src/modules/sucursales-docs/`](../../../../src/modules/sucursales-docs/)
- [`src/modules/bolsa-sync/`](../../../../src/modules/bolsa-sync/)

Problemas actuales:

- Tienen valor real pero estilos y contratos disparejos.

Prioridad:

- `P2` o `P3` segun impacto

Que hacer:

- Unificar layout y feedback.
- Normalizar errores.
- Alinear rutas y permisos.
- Integrarlos como cards dentro del nuevo shell progresivo.

Pruebas:

- Smoke test por modulo.
- Verificacion de rutas publicas.
- Confirmacion de datos visibles.

---

## 4. Orden recomendado de ejecucion

### Ola 1: Base tecnica

1. AppShell / Cache backend
2. Configuracion y arranque
3. Portal / Home
4. Dashboard / Status
5. Jobs / Syncs

### Ola 2: Modulos de mayor valor

1. Planeacion
2. Facturacion
3. Contabilidad
4. WhatsApp Capacitadores

### Ola 3: Modulos complementarios

1. Faltantes Ley
2. Poliza Ley
3. Pedidos Ley
4. Separar PIPC
5. Solventaciones
6. Sucursales Docs
7. Bolsa Sync

### Ola 4: Cierres y refinamiento

1. Constancias v2
2. Ajustes de UX comun
3. Eliminacion de rutas viejas
4. Limpieza de deuda tecnica visible

---

## 5. Recomendacion practica

Si vamos a ejecutar esto bien, el siguiente paso no es tocar codigo al azar.

El siguiente paso correcto es:

1. Definir el backlog de la Ola 1.
2. Estimar impacto por modulo.
3. Seleccionar el primer modulo piloto para refactor.
4. Asegurar que QA siga corriendo paralelo.

Mi recomendacion para piloto ahora es `AppShell / Cache backend`, porque obliga a sanear contrato, navegacion, datos comunes y experiencia antes de mover el resto.

---

## 6. Resultado esperado

Al terminar esta primera secuencia deberiamos tener:

- una entrada clara al sistema,
- una cache backend util y persistente,
- una QA realmente separada de prod,
- observabilidad util,
- modulos principales mejor encapsulados,
- y una ruta realista para reemplazar `apps.desarrolloeg.com` sin interrupciones.
