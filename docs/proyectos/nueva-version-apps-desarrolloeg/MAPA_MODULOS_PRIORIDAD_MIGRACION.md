# Mapa de modulos y prioridad de migracion

Fecha: 2026-07-31

Base:
- [Plan de nueva version de `apps.desarrolloeg.com`](./PLAN_NUEVA_VERSION_APPS_DESARROLLOEG.md)

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
| Portal / Home | P0 | Es la puerta de entrada de todo el sistema | Unificar layout, rutas, auth y ambiente |
| Dashboard / Status | P0 | Da visibilidad operativa y puede arrastrar links malos | Hacerlo ambiente-aware y sin enlaces duros |
| Configuracion y arranque | P0 | Define QA vs prod y evita fugas entre ambientes | Centralizar env vars, cookies, redirects y health |
| Jobs / Syncs | P0 | Afecta datos, tiempos y soporte operativo | Clasificar jobs, agregar observabilidad y control |
| Planeacion | P1 | Es amplio, sensible y ya tiene mucho backlog | Separar dominio, UI, integracion y sincronizacion |
| Facturacion | P1 | Alto valor y primera carga pesada | Aislar servicios, optimizar render y cache |
| Contabilidad | P1 | Integracion delicada con dependencia externa | Encapsular cliente y formalizar contrato |
| WhatsApp Capacitadores | P1 | Experiencia de soporte visible | Crear landing clara, health y QR |
| Constancias v2 | P2 | Ya tiene identidad propia y puede evolucionar aparte | Mantener autonomia y evaluar extraccion futura |
| Modulos auxiliares operativos | P2 | Utiles pero heterogeneos | Estandarizar navegacion, errores y permisos |
| Bolsa Sync | P2 | Integracion puntual | Encapsular y observar bien |
| Sucursales Docs | P3 | Funcionalidad de apoyo | Mantener estable con minima intervencion |
| Separar PIPC | P3 | Alcance acotado | Refactor solo si entra en la ola de UX |
| Solventaciones | P3 | Utilidad especifica | Normalizar cuando toque limpiar front compartido |
| Faltantes Ley / Poliza Ley / Pedidos Ley | P2 | Tienen valor operativo pero pueden migrar en lote | Unificar contrato de vistas y APIs |

---

## 3. Detalle por modulo

### 3.1 Portal / Home

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
- Consolidar identidad visual y navegación.

Pruebas:

- Login correcto.
- Sesion aislada entre ambientes.
- Links internos siempre apuntan al mismo ambiente.

### 3.2 Dashboard / Status

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

Pruebas:

- QA muestra solo enlaces QA.
- Prod muestra solo enlaces prod.
- Health responde con metadata consistente.

### 3.3 Configuracion y arranque

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

Pruebas:

- Boot correcto en QA.
- Boot correcto en prod.
- `health` declara ambiente real.

### 3.4 Jobs / Syncs

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

Pruebas:

- Corridas manuales controladas.
- Falla visible con mensaje util.
- Health de jobs confiable.

### 3.5 Planeacion

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
- Priorizar experiencias de uso reales.

Pruebas:

- Búsquedas y flujos principales.
- Sincronizacion y exportacion.
- Compatibilidad con AppSheet.

### 3.6 Facturacion

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

### 3.7 Contabilidad

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

Pruebas:

- Llamadas exitosas.
- Manejo de error externo.
- Contratos estables.

### 3.8 WhatsApp Capacitadores

Ubicacion:

- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js)
- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js)

Problemas actuales:

- La experiencia base no debe sentirse como ruta suelta o técnica.

Prioridad:

- `P1`

Que hacer:

- Landing clara.
- Acceso a QR.
- Health y estado visible.

Pruebas:

- Ruta base no responde 404.
- QR accesible.
- Estado entendible.

### 3.9 Constancias v2

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

Pruebas:

- Carga correcta.
- Assets correctos.
- Navegacion estable.

### 3.10 Modulos auxiliares operativos

Incluye:

- [`src/modules/faltantes-ley/`](../../../../src/modules/faltantes-ley/)
- [`src/modules/poliza-ley/`](../../../../src/modules/poliza-ley/)
- [`src/modules/separar-pipc/`](../../../../src/modules/separar-pipc/)
- [`src/modules/solventaciones/`](../../../../src/modules/solventaciones/)
- [`src/modules/sucursales-docs/`](../../../../src/modules/sucursales-docs/)
- [`src/modules/bolsa-sync/`](../../../../src/modules/bolsa-sync/)
- [`src/modules/pedidos-ley/`](../../../../src/modules/pedidos-ley/)

Problemas actuales:

- Tienen valor real pero estilos y contratos disparejos.

Prioridad:

- `P2` o `P3` segun impacto

Que hacer:

- Unificar layout y feedback.
- Normalizar errores.
- Alinear rutas y permisos.

Pruebas:

- Smoke test por modulo.
- Verificacion de rutas publicas.
- Confirmacion de datos visibles.

---

## 4. Orden recomendado de ejecucion

### Ola 1: Base tecnica

1. Configuracion y arranque
2. Portal / Home
3. Dashboard / Status
4. Jobs / Syncs

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

Mi recomendacion para piloto es `Portal / Home`, porque afecta toda la experiencia y obliga a sanear configuracion, rutas y ambiente desde la base.

---

## 6. Resultado esperado

Al terminar esta primera secuencia deberiamos tener:

- una entrada clara al sistema,
- una QA realmente separada de prod,
- observabilidad util,
- modulos principales mejor encapsulados,
- y una ruta realista para reemplazar `apps.desarrolloeg.com` sin interrupciones.
