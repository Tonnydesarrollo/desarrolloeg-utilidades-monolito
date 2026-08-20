# Plan de nueva version de `apps.desarrolloeg.com`

Fecha: 2026-07-31

Objetivo:
Construir una nueva version del sistema actual en paralelo, con su propia URL de prueba `qa.apps.desarrolloeg.com`, sin afectar la operacion productiva de `apps.desarrolloeg.com` hasta que la version nueva este estabilizada y aprobada.

Este documento analiza el sistema actual por partes y traduce ese analisis en una ruta de ejecucion para una mejor version.

---

## 1. Principio de trabajo

La nueva version no debe nacer como una migracion directa "big bang".

La estrategia correcta es:

- Mantener la version actual en produccion.
- Levantar una version paralela en QA.
- Separar configuracion, cookies, callbacks y observabilidad por ambiente.
- Migrar modulo por modulo con validacion funcional real.
- Reemplazar la imagen productiva solo cuando la nueva version sea equivalente o superior.

Esto evita impacto operativo y permite comparar comportamiento entre versiones.

---

## 2. Foto actual del sistema

El monolito actual concentra varias capacidades en una misma aplicacion Express:

- Portal principal y autenticacion.
- Dashboard y estado operativo.
- Facturacion.
- Contabilidad.
- Planeacion.
- Constancias.
- Jobs y sincronizaciones.
- Modulos publicos auxiliares.
- Flujos especiales como WhatsApp Capacitadores, Bolsa Sync, Solventaciones, Faltantes Ley y Separar PIPC.

El sistema funciona, pero tiene sintomas tipicos de crecimiento organico:

- Mucha logica en una sola base de despliegue.
- Rutas con convenciones heterogeneas.
- Dependencias directas a servicios externos y a archivos locales.
- Configuracion sensible mezclada entre runtime, portal y jobs.
- Algunos enlaces, redirects y pruebas siguen apuntando a produccion.

---

## 3. Analisis por partes del sistema

### 3.1 Capa de entrada y composicion general

Archivos relevantes:

- [`src/app.js`](../../../../src/app.js)
- [`src/server.js`](../../../../src/server.js)
- [`src/config/env.js`](../../../../src/config/env.js)

Estado:

- `app.js` registra todos los routers en una sola composicion.
- La aplicacion tiene middlewares de compatibilidad por host y ambiente.
- El health endpoint ya expone metadata util.

Lectura tecnica:

- La composicion actual es correcta para un monolito, pero ya esta en el limite de mantenibilidad.
- Hace falta formalizar capas internas: entrada, dominio, integraciones, jobs, vistas, utilidades.
- El arranque debe distinguir con claridad entre `prod`, `qa` y `dev`.

Plan:

- Mantener un solo proceso base por ahora, pero modularizar internamente.
- Separar configuracion por ambiente desde el inicio de la nueva version.
- Introducir convenciones de rutas y naming estables.
- Como rama alternativa, formalizar una arquitectura donde AppSheet siga siendo la base principal y el backend sostenga cache persistente para servir al frontend por AJAX. Ver [arquitectura alternativa AppSheet + cache backend](/C:/Users/devssh/Documents/Programacion/DESARROLLOEG_UTILIDADES_MONOLITO/docs/proyectos/nueva-version-apps-desarrolloeg/ARQUITECTURA_APP_CACHE_BACKEND.md).

### 3.2 Portal y autenticacion

Archivos relevantes:

- [`src/modules/home/home.router.js`](../../../../src/modules/home/home.router.js)
- [`src/modules/home/portalAuth.service.js`](../../../../src/modules/home/portalAuth.service.js)
- [`src/modules/home/portalPath.js`](../../../../src/modules/home/portalPath.js)

Estado:

- El portal concentra la entrada principal del usuario.
- Hay compatibilidad de rutas y entorno.
- La experiencia depende mucho del host y del path.

Lectura tecnica:

- Esta capa es critica porque define la experiencia de entrada.
- Si el portal no esta limpio, todo lo demas se percibe desordenado.
- Los callbacks, cookies y redirects deben variar por ambiente.

Plan:

- Diseñar un portal con estructura estable y rutas claras.
- Formalizar una unica fuente de verdad para el path del portal.
- Evitar que QA comparta cookies o callbacks con prod.
- Definir un layout principal reutilizable para modulos publicos.

### 3.3 Dashboard y estado operacional

Archivos relevantes:

- [`src/modules/dashboard/dashboard.router.js`](../../../../src/modules/dashboard/dashboard.router.js)
- [`src/modules/dashboard/dashboard.service.js`](../../../../src/modules/dashboard/dashboard.service.js)
- [`src/services/clusterCoordinator.js`](../../../../src/services/clusterCoordinator.js)

Estado:

- El dashboard agrega salud y accesos de servicios.
- Parte del contenido tenia referencias duras a produccion.

Lectura tecnica:

- El dashboard debe ser ambiente-aware.
- En una nueva version, cualquier enlace a health, paneles o rutas derivadas debe resolverse desde configuracion, no desde texto duro.

Plan:

- Convertir el dashboard en una capa de observabilidad de producto, no solo de links.
- Mostrar version, ambiente, estado del cluster y estado de jobs.
- Ajustar enlaces para que QA siempre navegue dentro de QA.

### 3.4 Planeacion

Archivos relevantes:

- [`src/modules/planeacion/planeacion.router.js`](../../../../src/modules/planeacion/planeacion.router.js)
- [`src/modules/planeacion/services/appsheet.js`](../../../../src/modules/planeacion/services/appsheet.js)
- [`src/modules/planeacion/services/csvStore.js`](../../../../src/modules/planeacion/services/csvStore.js)
- [`src/modules/planeacion/services/geocode.js`](../../../../src/modules/planeacion/services/geocode.js)
- [`src/modules/planeacion/public/assets/`](../../../../src/modules/planeacion/public/assets/)

Estado:

- Es uno de los modulos mas ricos y mas sensibles.
- Mezcla UI, datos locales, integracion con AppSheet y recursos estaticos.
- Tiene ya bastante trabajo de backlog y rediseño documentado.

Lectura tecnica:

- Planeacion es candidato a ser el primer modulo refactorizado en serio.
- Tiene suficiente masa funcional para justificar una arquitectura interna propia.
- Es donde mas valor daria separar frontend, servicios de negocio y adaptadores externos.

Plan:

- Extraer un dominio de planeacion claro:
  - catalogos
  - operaciones
  - geocoding
  - sincronizacion
  - exportaciones
- Mantener AppSheet como integracion hasta que exista decision expresa de migracion.
- Reducir dependencia de CSV como estado primario.
- Replantear la UI de planeacion con foco en tareas, no en tablas sueltas.

### 3.5 Facturacion

Archivos relevantes:

- [`src/modules/facturacion/facturacion.router.js`](../../../../src/modules/facturacion/facturacion.router.js)
- [`src/modules/facturacion/services/construirDataHTML.js`](../../../../src/modules/facturacion/services/construirDataHTML.js)
- [`src/modules/facturacion/services/appsheet.js`](../../../../src/modules/facturacion/services/appsheet.js)
- [`src/modules/facturacion/utils/`](../../../../src/modules/facturacion/utils/)
- [`src/modules/facturacion/views/`](../../../../src/modules/facturacion/views/)

Estado:

- Es un modulo de alto valor operativo.
- Tiene logica de formateo, PDF/HTML, integraciones y vistas.
- Parece cargar bastante en la primera visita.

Lectura tecnica:

- Facturacion merece una separacion clara entre:
  - dominio de negocio
  - render de vistas
  - integracion con terceros
  - utilidades de formateo
- El costo de la primera carga sugiere necesidad de cache, precompilacion o carga diferida.

Plan:

- Introducir capa de servicios de facturacion mas pequena y testeable.
- Reducir logica en views y helpers dispersos.
- Medir y optimizar el primer render.
- Encapsular credenciales y accesos a Drive/AppSheet.

### 3.6 Contabilidad

Archivos relevantes:

- [`src/modules/contabilidad/contabilidad.router.js`](../../../../src/modules/contabilidad/contabilidad.router.js)
- [`src/modules/contabilidad/contabilidad.service.js`](../../../../src/modules/contabilidad/contabilidad.service.js)
- [`src/modules/contabilidad/contabilidad.client.js`](../../../../src/modules/contabilidad/contabilidad.client.js)

Estado:

- Es una integracion especializada con logica de negocio de soporte.

Lectura tecnica:

- Debe tener una interfaz minima y bien aislada.
- Es candidato a encapsular dependencias externas detras de un cliente estable.

Plan:

- Formalizar contrato de entrada y salida.
- Evitar que el router decida reglas de negocio.
- Asegurar trazabilidad de errores y respuestas externas.

### 3.7 Constancias v2

Archivos relevantes:

- [`src/modules/constancias-v2/constanciasV2.router.js`](../../../../src/modules/constancias-v2/constanciasV2.router.js)
- [`src/modules/constancias-v2/public/`](../../../../src/modules/constancias-v2/public/)

Estado:

- Tiene una experiencia mas autocontenida, cercana a un mini producto.

Lectura tecnica:

- Es una buena candidata para extraerse a un modulo independiente o a una app dedicada si sigue creciendo.
- Su front ya tiene cierta identidad propia.

Plan:

- Conservar su independencia visual.
- Estandarizar su contrato de rutas y assets.
- Evaluar si se convierte en un micro-frontend o en una app aparte en una segunda etapa.

### 3.8 Jobs y sincronizaciones

Archivos relevantes:

- [`src/modules/jobs/jobs.router.js`](../../../../src/modules/jobs/jobs.router.js)
- [`src/modules/jobs/services/`](../../../../src/modules/jobs/services/)
- [`src/modules/jobs/native/`](../../../../src/modules/jobs/native/)
- [`src/services/backgroundServices.js`](../../../../src/services/backgroundServices.js)

Estado:

- El sistema de jobs es una de las piezas mas criticas.
- Integra syncs nativos, trackers de ejecucion y estados locales.
- Algunos jobs son dependientes de sitios externos con sesiones o timeouts.

Lectura tecnica:

- Los jobs no deben tratarse como scripts sueltos.
- Necesitan registro, estado, reintento, timeout, logs y visibilidad.
- La nueva version debe tener un panel de salud de jobs y criterios de degradacion claros.

Plan:

- Crear inventario oficial de jobs.
- Clasificar cada job como:
  - critico
  - importante
  - diferible
  - manual
- Normalizar:
  - timeout
  - reintentos
  - alertas
  - persistencia de ejecucion
- Separar jobs de lectura, escritura y navegacion.

### 3.9 WhatsApp Capacitadores

Archivos relevantes:

- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js)
- [`src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js`](../../../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js)

Estado:

- El modulo existe, pero su experiencia base necesita ser mas amigable.

Lectura tecnica:

- Debe tener landing util, health y acceso rapido al QR o estado actual.
- Es una pieza de soporte, no un enlace roto.

Plan:

- Crear experiencia de entrada clara.
- Mantener QR, health y estado en una sola vista.
- Evitar que el modulo dependa del conocimiento tecnico del usuario.

### 3.10 Modulos auxiliares de operacion

Incluye:

- [`src/modules/faltantes-ley/`](../../../../src/modules/faltantes-ley/)
- [`src/modules/poliza-ley/`](../../../../src/modules/poliza-ley/)
- [`src/modules/separar-pipc/`](../../../../src/modules/separar-pipc/)
- [`src/modules/solventaciones/`](../../../../src/modules/solventaciones/)
- [`src/modules/sucursales-docs/`](../../../../src/modules/sucursales-docs/)
- [`src/modules/bolsa-sync/`](../../../../src/modules/bolsa-sync/)
- [`src/modules/pedidos-ley/`](../../../../src/modules/pedidos-ley/)

Estado:

- Son modulos funcionales, pero muy heterogeneos entre si.
- Algunos son apps pequeñas; otros son integraciones o utilidades.

Lectura tecnica:

- No conviene forzarlos a un solo estilo visual si no aportan valor.
- Si la nueva version busca mejor experiencia, estos modulos deben normalizarse al menos en navegacion, autenticacion y observabilidad.

Plan:

- Definir un kit de experiencia comun.
- Estandarizar headers, estados vacios, errores y permisos.
- Identificar cuales deben quedarse como vistas internas y cuales merecen su propia entrada.

---

## 4. Arquitectura objetivo para la nueva version

La mejor version no deberia ser una copia del monolito actual con colores distintos.

Deberia evolucionar hacia un monolito modular mas limpio, con estas capas:

1. Capa de entrada
- routing
- middleware
- autenticacion
- control de ambiente

2. Capa de dominio
- reglas de negocio por modulo
- casos de uso
- validaciones

3. Capa de integracion
- AppSheet
- Drive
- Cloudflare
- WhatsApp
- servicios nativos

4. Capa de presentacion
- HTML
- vistas
- portal
- dashboards
- experiencias publicas

5. Capa operativa
- jobs
- health
- trazabilidad
- telemetry

Esta estructura permite crecer sin que todo siga dependiendo de todo.

---

## 5. Nueva estrategia de ambientes

La nueva version debe funcionar asi:

- `apps.desarrolloeg.com`:
  - version estable productiva
  - cambios solo cuando ya estan validados

- `qa.apps.desarrolloeg.com`:
  - version paralela
  - pruebas, comparacion y validacion
  - sin contaminar cookies, callbacks ni datos de prod

Requisitos tecnicos:

- `APP_ENVIRONMENT` explicito.
- Puertos separados.
- Cookies separadas.
- Redirects OAuth separados.
- URL de health separada.
- Volumenes y runtime propios.

---

## 6. Plan de migracion por fases

### Fase 1. Congelar el objetivo

Entregables:

- inventario de modulos
- mapa de dependencias
- lista de rutas criticas
- lista de jobs criticos
- lista de integraciones externas

### Fase 2. Preparar la plataforma paralela

Entregables:

- entorno QA funcionando
- DNS y tunnel listos
- configuracion independiente
- health visible
- dashboard apuntando al ambiente correcto

### Fase 3. Normalizar el core

Entregables:

- router principal simplificado
- configuracion centralizada
- convenciones de nombres
- errores y logs uniformes

### Fase 4. Refactorizar modulos de mayor valor

Orden sugerido:

1. Portal y autenticacion
2. Dashboard y health
3. Planeacion
4. Facturacion
5. Jobs y syncs
6. Modulos auxiliares

### Fase 5. Mejorar UX y consistencia

Entregables:

- layout comun
- tipografia y espaciado unificados
- componentes de estados vacios y error
- navegacion predecible

### Fase 6. Validacion final y corte

Entregables:

- comparativa QA vs prod
- checklist funcional
- smoke tests
- rollback plan
- cambio de imagen productiva

---

## 7. Criterios para decir que la nueva version es mejor

La nueva version solo debe reemplazar la actual si cumple al menos esto:

- El portal es mas claro y mas rapido de entender.
- QA y prod viven separados de verdad.
- Los links no salen accidentalmente a prod.
- Los jobs criticos se observan y diagnostican mejor.
- Planeacion y facturacion tienen menos friccion.
- Los errores son mas legibles.
- El tiempo de mantenimiento baja.
- La arquitectura interna es mas legible para cualquier nuevo integrante.

---

## 8. Riesgos principales

- Seguir creciendo la misma base sin modularizar.
- Mezclar configuracion de QA y prod.
- Mantener enlaces duros a URLs productivas.
- Reescribir demasiado antes de tener inventario completo.
- Tocar jobs criticos sin observabilidad suficiente.

---

## 9. Recomendacion ejecutiva

No conviene "hacer otra version" como copia cosmetica.

Conviene hacer una version mejor organizada, con:

- separacion real de ambientes
- mejor experiencia de entrada
- modulos mas aislados
- health y jobs visibles
- integraciones encapsuladas
- plan de migracion por capas

Ese es el camino mas seguro para que `qa.apps.desarrolloeg.com` sea un espacio real de validacion y no solo un clon temporal.

---

## 10. Siguiente entrega sugerida

El siguiente documento ideal es un mapa por modulo con esta estructura:

- objetivo del modulo
- problemas detectados
- dependencias
- prioridad de migracion
- estrategia tecnica
- pruebas necesarias

Si quieres, el siguiente paso puede ser ese mapa modulo por modulo para empezar a trabajar con orden real.
