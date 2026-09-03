# Auditoria de requerimientos, UI/UX y frontend

Fecha: 2026-08-28

## Alcance

Esta auditoria cruza:

- Las dos hojas de `REQUERIMIENTOS DE NEGOCIO.xlsx`.
- La implementacion actual de `DESARROLLOEG_UTILIDADES_MONOLITO`.
- La version de produccion disponible localmente de Bolsa de Trabajo Cloudflare.
- Los contratos ya documentados de base local, webhook, auditoria y tiempo real.

El objetivo no es copiar una pantalla de Bolsa de Trabajo, sino adoptar sus contratos de producto: jerarquia, navegacion, componentes, estados, accesibilidad, comportamiento responsive y consistencia.

## Dictamen ejecutivo

La plataforma ya tiene una parte importante de la logica operativa y de sincronizacion, pero el frontend todavia funciona como una coleccion de herramientas unidas por un shell visual. No existe una capa unica que garantice simultaneamente:

1. Permisos por capacidad y alcance.
2. URL como fuente de verdad de la navegacion.
3. Componentes visuales compartidos.
4. Estados de carga, vacio, error, exito y actualizacion consistentes.
5. Actualizacion incremental en tiempo real sin recargar la pagina.
6. Contratos de datos normalizados por modulo.

El principal riesgo no es la falta de CSS. Es la arquitectura del frontend: `src/modules/home/home.router.js` concentra cerca de diez mil lineas de HTML, CSS y JavaScript generado en servidor, mientras los demas modulos mantienen sus propios estilos y scripts. El shell global intenta unificarlos con selectores amplios y `!important`. Esto hace que cada correccion local tenga una probabilidad alta de producir regresiones en otras vistas.

La recomendacion es conservar Express, SQLite, jobs, webhook y sincronizacion, pero migrar el portal de manera gradual a un frontend tipado y basado en rutas y componentes. No se recomienda una reescritura simultanea de toda la plataforma.

## Contrato de negocio consolidado

### Roles y permisos

| Puesto | Vistas | Acciones | Alcance |
| --- | --- | --- | --- |
| Mejora Continua | Todas | Todas | Todos |
| Director General | Todas | Todas | Todos |
| Gerente General | Todas | Ver, agregar y editar | Todos |
| Capacitador | Calendario | Ver, agregar y editar | Propios |
| Capacitador | Capacitaciones | Ver, agregar y editar | Propios |
| Capacitador | Constancias faltantes | Ver | Propios |
| Capacitador | Crear constancias | Crear y actualizar diplomas | Propios |
| Capacitador | Informacion de sucursales | Ver | Todos |
| Capacitador | Notas | Agregar, editar y eliminar propias; ver todas | Propias con lectura global |

Regla estructural: el permiso debe evaluarse en servidor para cada lectura y mutacion. Ocultar un boton en frontend no es un control de autorizacion.

### Pedidos

Los pedidos deben poder verse como `Todos`, `Liberados`, `Sin liberacion enviados`, `Sin liberacion no enviados`, `Sin liberacion`, `No pagados`, `Pagados` y `Sin pedido`.

- `Liberados`: existe en `LIBERACIONES` y todavia no existe la factura correspondiente en `FACTURAS LEY`.
- La navegacion pedido-factura se resuelve por la cadena pedido -> `CLUBFACTURA.UUID` -> `FACTURAS LEY.UUID`.
- `Sin liberacion no enviados`: no existe liberacion, no se ha enviado y la sucursal tiene el trabajo estatal o municipal del pedido en el anio solicitado.
- `Sin liberacion enviados`: no existe liberacion y el indicador persistente de envio esta activo.
- `Sin liberacion`: no existe liberacion, no esta enviado y tampoco existe el trabajo correspondiente.
- `No pagados`: existe factura, pero ni su UUID ni su liberacion aparecen en `PAGADOS_LEY`.
- `Pagados`: el UUID aparece en `PAGADOS_LEY.UUID` o la liberacion aparece en `PAGADOS_LEY.ASIGNACION`.
- `Sin pedido`: la sucursal tiene trabajo estatal o municipal, pero no un pedido de ese tipo para el anio.
- El umbral estatal base es `$32,967.49`.
- El umbral municipal base es `$11,000.00` y debe admitir configuracion por anio.

### Reporte Casa Ley

Debe mostrar las tiendas Casa Ley que tengan trabajo municipal o estatal, incluyendo:

- Label de sucursal.
- Municipio y estado.
- Estado de capacitacion.
- Capacitador.
- Trabajo municipal del anio en curso.
- Trabajo estatal del anio en curso.
- Estado de PC Estatal cruzado por `SUCURSALES.ID_PC`; sin registro del anio corresponde a `PENDIENTE`.

### Capacitaciones y constancias

- Calendario y listado deben mostrar todas las capacitaciones que entren en el alcance del usuario.
- El detalle debe conservar el contexto de navegacion, no sentirse como una pagina ajena.
- Las capacitaciones sin diplomas deben listarse por sede y fecha.
- El generador debe vivir dentro de la plataforma con selector de capacitador, capacitacion, sede y fecha.
- Para un capacitador, el selector debe iniciar filtrado a su identidad.
- Para perfiles globales, elegir capacitador filtra las capacitaciones en la misma vista; no navega al perfil del empleado.
- `DIPLOMAS` es un control vivo `SI/NO`, visible y modificable en contexto.
- El generador integrado debe usar sucursales, razon social y logo del cliente.

El estado calculado sigue la regla de negocio `TODAY() > FECHA => FINALIZADA`; una capacitacion con fecha de hoy o futura permanece `PROGRAMADA`.

### Empresas y sucursales

- La primera vista muestra empresas, no sucursales desplegadas debajo.
- Seleccionar una empresa abre una ruta propia de perfil.
- El perfil usa logo, nombre comercial y razon social de `EMPRESAS`.
- Las sucursales se agrupan `ESTADO -> MUNICIPIO` y se muestran por label.
- Estados, municipios y cualquier elemento expandible cargan contraidos.
- Estados y municipios muestran su escudo cuando existe uno valido.
- Los conteos de expansores se recalculan despues de aplicar filtros.
- El filtro `Trabajo` es agregativo.
- `Ultimo trabajo` depende del tipo de trabajo seleccionado y de estados validos `EN DRIVE`, `IMPRESO` o `ENTREGADO`.
- El buscador de pedido consulta pedido estatal y municipal.
- La tarjeta de sucursal debe incluir pedido estatal y municipal vigentes, ultimo PIPC estatal, ultimo municipal, trabajos configurados, capacitacion, capacitador, planeacion con nombre del mes, riesgo y precios.

### Notas

- Toda vista que admita observaciones debe permitir agregar notas segun permisos.
- Las notas son hilos, no un campo de texto que se reemplaza.
- Cada entrada identifica creador, fecha y contenido.
- Creador y empleado etiquetado son conceptos distintos.
- Un capacitador puede editar o eliminar solamente sus notas, pero puede leer todas las visibles en su alcance.

## Contratos de Bolsa de Trabajo

Los patrones que deben trasladarse son los siguientes:

### Navegacion

- Rutas declarativas y URL como fuente de verdad.
- Enlaces reales con estado activo derivado de la ruta.
- Grupos funcionales estables.
- Barra superior con marca, contexto actual y cuenta.
- Sidebar o drawer responsive, no una coleccion de botones flotantes.
- Drawer modal con foco inicial, ciclo de `Tab`, cierre con `Escape`, restauracion de foco y bloqueo del fondo.
- Al usar atras, adelante o recargar, se conserva exactamente la vista representada por la URL.

### Jerarquia de pagina

- Un solo `PageHeader` por vista: contexto, titulo, descripcion corta y acciones primarias.
- El contenido principal empieza inmediatamente despues del encabezado.
- Una accion primaria por tarea; acciones secundarias visualmente subordinadas.
- Los controles pertenecen al elemento que gobiernan. Por ejemplo, los filtros y `DIPLOMAS` forman parte del Generador de Constancias, no otra pagina colocada arriba.

### Componentes

- `StatusTabs`: opciones con estado activo, conteo y `aria-pressed`.
- `FilterBar`: campos coherentes, resumen de filtros activos y accion `Limpiar`.
- Tarjetas y paneles con variantes controladas, no CSS por pantalla.
- Estados comunes: `Loading`, `Empty`, `Error`, `Stale`, `Saving`, `Success`.
- Tablas en escritorio y representacion de tarjeta o lista semantica en movil.
- Disclosure, dialog, tabs, combobox y alertas con comportamiento de teclado definido.

### Lenguaje visual

- Variables de color, superficies, texto, borde, sombra, radio, espacio y movimiento.
- Fondo atmosferico institucional con gradientes/patron sutil.
- Superficies translucidas y bordes suaves solo para expresar jerarquia.
- Tipografia expresiva y consistente.
- Densidad controlada: informacion operativa escaneable, sin cajas anidadas innecesarias.
- Movimiento breve y funcional, con soporte para `prefers-reduced-motion`.

## Matriz de cumplimiento actual

| Area | Estado | Evidencia y brecha principal |
| --- | --- | --- |
| Base local persistente | Avanzado | Repositorios locales, SQLite, jobs y webhook ya forman la fuente operativa principal. |
| Tiempo real backend | Parcial | Existe SSE y el webhook despierta al portal, pero el cliente suele resolver el cambio con `window.location.reload()`. |
| URL y navegacion | Parcial | Las tabs actualizan historial, pero conviven rutas, tabs, redirects y modulos externos sin un router unico. |
| Matriz de permisos | Critico | `portalAccessPolicy.js` modela correctamente el Excel, pero sus helpers solo se usan en pruebas; las rutas siguen autorizando con `user.role === "admin"`. |
| Gerente General | No conforme | Comparte rol tecnico `admin`; puede heredar acciones de eliminacion que el Excel no concede. |
| Capacitador | Parcial | El alcance propio se aplica en varias consultas, pero no existe una politica central usada por todas las rutas y botones. |
| Calendario | Parcial avanzado | Hay calendario, detalle, notas, autor y eventos en vivo; todavia depende de JavaScript inline y recargas completas. |
| Capacitaciones | Parcial | Hay grupos, filtros, detalle y controles de diplomas/notas; no se identifico un CRUD completo de capacitaciones conforme a `AGG, EDITAR`. |
| Constancias faltantes | Implementado parcial | Se deriva la lista sin diplomas; falta convertir el flujo completo en experiencia nativa y uniforme. |
| Generador de constancias | Parcial | Selectores y control de diplomas existen, pero el generador sigue embebido en `iframe`, por eso se perciben dos productos pegados. |
| Empresas | Parcial avanzado | Directorio y ruta de perfil existen, con agrupacion y filtros; el contrato visual y los datos enriquecidos no estan encapsulados en componentes. |
| Notas | No conforme | `CAPACITACIONES.NOTAS` se sobrescribe como texto. Las notas de calendario tienen otro modelo. No hay hilo transversal unico. |
| Eliminacion de notas | Critico | La ruta de eliminar nota de calendario autentica, pero no verifica autor ni capacidad de eliminacion. |
| Pedidos | Avanzado en negocio | La clasificacion implementa liberacion, factura, pago, trabajo y envio. Falta robustecer coincidencias y simplificar la experiencia. |
| Pagados por asignacion | Riesgo | Se usa coincidencia por subcadena en `ASIGNACION`; puede producir falsos positivos si un identificador esta contenido en otro. |
| Sin pedido | Parcial avanzado | Existe cobertura por sucursal, pero necesita pruebas de aceptacion con casos reales por tipo y anio. |
| Reporte Casa Ley | Parcial avanzado | La vista y el cruce PC existen; debe formalizarse el contrato de fecha/estado y eliminar documentacion obsoleta. |
| Cotizaciones | Funcional aislado | Se muestran y crean, pero todavia pertenecen a una experiencia de modulo separado. |
| Consistencia visual | No conforme | El dashboard y los modulos tienen CSS local; el shell global usa reglas amplias y numerosos `!important`. |
| Responsive | Parcial | Hay ajustes y drawer movil, pero las tablas y acciones no comparten una estrategia responsive unica. |
| Accesibilidad | Parcial | Ya hay landmarks, tabs, `aria-live` y control de foco en algunas zonas; falta garantizarlo mediante componentes y pruebas. |
| Rendimiento percibido | No conforme | Recargas completas, HTML monolitico, iframes y scripts inline impiden actualizaciones finas y estados transicionales consistentes. |
| Mantenibilidad frontend | Critico | Un unico router genera casi toda la aplicacion y mezcla datos, autorizacion, plantilla, estilos e interaccion. |

## Hallazgos prioritarios

### P0. Autorizacion declarada pero desconectada

`portalAccessPolicy.js` contiene una representacion razonable del Excel, pero `canUsePortalView`, `getPortalViewPermission` y `canViewAllForPortalView` no participan en las rutas productivas. La aplicacion reduce los perfiles a `admin` o `capacitador`.

Impactos:

- Gerente General puede recibir capacidades de Director/Mejora Continua.
- Los botones pueden expresar permisos distintos a los endpoints.
- Cada modulo vuelve a implementar alcance y autorizacion.
- Una nueva pantalla puede quedar expuesta por omision.

Correccion objetivo:

- Middleware `requirePortalCapability(view, action, resolveResourceScope)`.
- Manifest de navegacion filtrado por la misma politica.
- DTO de sesion con capacidades, no decisiones duplicadas en cliente.
- Pruebas de contrato por rol, accion, recurso propio y recurso ajeno.

### P0. Notas no cumplen el dominio requerido

Hay dos conceptos separados:

- `CAPACITACIONES.NOTAS`, que se sobrescribe.
- Notas de `CALENDARIO`, con autor y empleados etiquetados.

El Excel requiere hilos reutilizables. Ademas, el endpoint de eliminacion de calendario no comprueba que el usuario sea el creador ni que tenga permiso global.

Modelo recomendado:

```text
note_threads
  id, entity_type, entity_id, created_at

note_entries
  id, thread_id, author_employee_id, body, created_at, updated_at, deleted_at

note_mentions
  note_entry_id, employee_id
```

La UI debe mostrar `Creador - fecha`, menciones separadas y acciones solo cuando la capacidad lo permita.

### P0. Frontend monolitico y cascada CSS inestable

El dashboard mezcla render, estilos e interaccion en un solo archivo. `portal-shell.css` fuerza apariencia sobre selectores genericos como tarjetas, botones y controles. Este enfoque no puede garantizar el contrato de Bolsa de Trabajo.

Correccion objetivo:

- Extraer tokens y componentes con nombres propios.
- Prohibir nuevos estilos inline y selectores globales de modulo.
- Reducir `!important` a excepciones documentadas.
- Migrar una ruta a la vez.

### P0. Tiempo real basado en recarga

El SSE detecta cambios, pero varias rutas de cliente llaman `window.location.reload()`. Eso actualiza datos, pero no ofrece una experiencia en tiempo real: pierde scroll, expansores, filtros, formularios y contexto.

Correccion objetivo:

- Evento SSE con `scope`, `table`, `action`, `entityId` y `version`.
- Invalidacion selectiva de consultas o actualizacion directa del registro.
- Indicador discreto `Actualizando` y conservacion de estado local.
- Recarga completa solo como recuperacion ante version incompatible.

### P1. Enrutamiento fragmentado

La aplicacion ha incorporado `pushState` para tabs, pero sigue combinando query params, rutas completas, enlaces externos, formularios con redirect e iframes. La URL debe representar toda vista navegable.

Mapa recomendado:

```text
/dashboard
/dashboard/calendario
/dashboard/capacitaciones
/dashboard/capacitaciones/:id
/dashboard/constancias
/dashboard/empresas
/dashboard/empresas/:id
/dashboard/pedidos
/dashboard/casa-ley
/dashboard/cotizaciones
/dashboard/notas
/dashboard/operacion/:modulo
```

Los filtros importantes deben poder serializarse en query params. Estado puramente visual, como un tooltip, permanece local.

### P1. Datos derivados sin contrato versionado

Las pantallas dependen de campos calculados como ultimo trabajo, estado de capacitacion, capacitador, pedido vigente, PC Estatal y precios. Algunos se calculan en render y otros en repositorios locales.

Correccion objetivo:

- Crear DTOs de lectura por vista.
- Materializar derivados costosos al cambiar tablas base.
- Incluir `computedAt`, `sourceVersion` y motivos de estado.
- No volver a consultar AppSheet al abrir una pantalla.

### P1. Codificacion y texto

Se observan cadenas con doble codificacion en el HTML generado. Aunque una parte puede verse agravada por la terminal, hay suficientes literales para tratarlo como deuda real.

Correccion objetivo:

- UTF-8 de extremo a extremo.
- Prueba que rechace secuencias frecuentes de mojibake.
- Evitar texto HTML construido en capas con escapes distintos.

## Arquitectura frontend recomendada

### Estrategia

Usar una migracion tipo strangler:

1. Mantener Express, SQLite, sincronizacion, jobs y servicios existentes.
2. Exponer APIs JSON normalizadas por pantalla.
3. Crear un frontend React + TypeScript + Vite siguiendo la estructura probada en Bolsa de Trabajo.
4. Montar el nuevo shell en `/dashboard` y migrar rutas gradualmente.
5. Mantener temporalmente modulos antiguos en rutas de compatibilidad.
6. Retirar HTML/CSS/JS inline cuando cada ruta alcance paridad funcional y pruebas.

No se requiere separar la persistencia del despliegue para esta migracion: la base local debe continuar en volumen persistente independiente de las imagenes de frontend y backend.

### Capas

```text
Frontend
  routes -> feature pages -> shared UI -> API client -> SSE client

Backend HTTP
  auth/capabilities -> route handlers -> view services -> repositories

Dominio local
  normalized operational DTOs -> computed projections -> SQLite

Sincronizacion
  AppSheet bots/webhook + audit reconciliation + native jobs
```

### Estado y concurrencia

- Usar la URL para navegacion, tab activa y filtros compartibles.
- Usar estado local para interaccion efimera.
- Diferir busquedas y filtros costosos para no bloquear escritura.
- Marcar cambios de vista no urgentes como transiciones.
- Aplicar actualizaciones optimistas solamente cuando exista rollback claro.
- Reconciliar el resultado definitivo con webhook/auditoria.

## Sistema de diseno objetivo

### Tokens minimos

```text
color: brand, accent, text, muted, surface, line, success, warning, danger
space: 4, 8, 12, 16, 24, 32, 48
radius: control, card, panel, pill
shadow: subtle, raised, overlay
type: display, heading, body, label, mono
motion: fast, normal, slow, easing-standard
layout: shell-max, sidebar-width, content-gutter
```

### Componentes obligatorios

- `AppShell`, `AppNav`, `MobileDrawer`, `AccountMenu`.
- `PageHeader`, `Breadcrumbs`.
- `Button`, `IconButton`, `Badge`, `StatusChip`.
- `TextField`, `Select`, `Combobox`, `MultiSelect`, `ToggleGroup`.
- `FilterBar`, `ActiveFilterSummary`, `StatusTabs`.
- `Surface`, `Card`, `StatCard`, `Disclosure`.
- `DataTable`, `ResponsiveDataList`, `Pagination`.
- `Dialog`, `Drawer`, `Toast`, `InlineAlert`.
- `LoadingState`, `EmptyState`, `ErrorState`, `StaleState`.
- `NoteThread`, `NoteComposer`, `MentionPicker`.
- `LiveRegion`, `SyncIndicator`.

### Reglas verificables

- Ningun modulo define su propia variante de boton, input, tab o tarjeta.
- Todo control tiene label accesible y estado de foco visible.
- Todo expansor inicia cerrado salvo excepcion declarada.
- Todo filtro muestra cantidad resultante y puede limpiarse.
- Todo listado define carga, vacio, error y datos obsoletos.
- Toda mutacion muestra estado pendiente y resultado.
- Ninguna actualizacion en tiempo real recarga la pagina por defecto.
- No se usa color como unico indicador de estado.

## Propuesta por vista

### Calendario

- `PageHeader` con fecha/contexto y accion `Nueva nota` o `Nueva capacitacion` segun capacidad.
- Toolbar integrada para vista, rango, capacitador y busqueda.
- Tarjetas de evento compactas: sede, hora, iniciales del capacitador y estado calculado.
- Detalle en drawer responsive, no una navegacion disruptiva.
- Notas como hilo dentro del detalle.
- Actualizacion incremental del evento recibido por SSE.

### Capacitaciones

- Tabs `Programadas` y `Finalizadas` con conteos.
- Filtros por fecha, sede, capacitador, diplomas y texto.
- Tarjeta resumida; detalle en panel o ruta dedicada segun profundidad.
- Un solo control `SI/NO` de diplomas, sin duplicarlo en encabezado y pie.
- Acciones visibles segun capacidades efectivas.

### Constancias

- Un unico `Generador de Constancias` como superficie principal.
- Selectores en una barra de contexto dentro de la misma superficie.
- Resumen de sede, fecha, capacitador y sucursales antes de generar.
- Vista previa nativa o adaptador visual del generador original; evitar que un iframe defina el layout.
- Control de diplomas junto a la accion de generacion.

### Empresas y sucursales

- Directorio de empresas con busqueda, conteo y tarjetas uniformes.
- Perfil de empresa en ruta propia.
- Encabezado de perfil con logo, nombre comercial, razon social y resumen.
- Filtros en una sola `FilterBar`.
- Estados y municipios en disclosures cerrados con conteos derivados del resultado filtrado.
- Tarjetas de sucursal escaneables; datos secundarios dentro del detalle expandido.

### Pedidos

- Tabs de negocio con conteos calculados en backend.
- Terminologia no ambigua: separar `Sin liberacion listo para enviar`, `Enviado` y `Sin trabajo`.
- Filtros avanzados en disclosure cerrado, con resumen de filtros activos.
- Tabla desktop y tarjetas mobile.
- Flujo de archivos en drawer/modal con remitente, destino, archivos y resultado.
- Tras enviar, actualizar el registro en la misma vista sin recarga.

### Reporte Casa Ley

- Filtros por estado, municipio, capacitacion, capacitador, trabajo y PC Estatal.
- Columnas con estado actual y anio visible.
- Explicacion de `PENDIENTE` disponible sin saturar la tabla.
- Exportacion como accion secundaria si el negocio la requiere.

### Cotizaciones y modulos operativos

- Cada modulo debe adoptar el mismo shell, encabezado y controles.
- Los formularios existentes pueden mantenerse, pero deben renderizar dentro de una ruta y superficie comunes.
- Jobs, WhatsApp y diagnosticos deben agruparse como `Operacion del sistema`, no competir con las tareas diarias en el primer nivel.

## Informacion y menu propuestos

```text
Operacion
  Calendario
  Capacitaciones
  Constancias
  Notas

Clientes
  Empresas y sucursales
  Reporte Casa Ley

Comercial y cobranza
  Pedidos
  Cotizaciones
  Facturacion

Documentos y cumplimiento
  Faltantes Ley
  Solventaciones
  Polizas
  Reportes

Sistema
  Sincronizacion y jobs
  WhatsApp
  Diagnostico
```

El menu se filtra por capacidades; no se crean versiones manuales distintas para cada rol.

## Criterios de aceptacion transversales

1. Recargar cualquier URL devuelve la misma vista, seleccion y recurso.
2. Atras y adelante restauran ruta y filtros sin estados fantasma.
3. Un Gerente General no puede eliminar, ni por UI ni por llamada directa.
4. Un capacitador no puede modificar recursos ajenos mediante IDs manipulados.
5. Una nota conserva historial, creador, fecha y menciones.
6. Un cambio de AppSheet visible en la pantalla aparece sin recarga completa.
7. Los filtros recalculan filas, conteos de tabs, estados y municipios.
8. Todos los expansores cargan cerrados.
9. Cada vista funciona con teclado y foco visible.
10. Los flujos principales funcionan en 360 px, tablet y escritorio.
11. La apertura de una vista operativa no depende de AppSheet disponible.
12. Los estados derivados exponen el anio y la razon que produjo el resultado.

## Plan de ejecucion recomendado

### Fase 0. Contratos y seguridad

- Conectar `portalAccessPolicy` a middleware, rutas y navegacion.
- Corregir autorizacion de notas.
- Formalizar DTOs y reglas derivadas.
- Congelar la creacion de nuevos estilos inline.

### Fase 1. Fundacion de frontend

- Crear workspace React/TypeScript/Vite.
- Portar tokens y componentes base desde los patrones de Bolsa de Trabajo.
- Implementar shell, router, sesion, capacidades, cliente API y SSE.
- Agregar pruebas visuales, accesibilidad y rutas.

### Fase 2. Primer flujo vertical

- Migrar Empresas -> Perfil -> Sucursales.
- Validar filtros, disclosures, escudos, responsive y URL.
- Usar este flujo para estabilizar el sistema de diseno.

### Fase 3. Operacion diaria

- Migrar Calendario, Capacitaciones y Constancias.
- Implementar hilos de notas.
- Sustituir recargas por invalidacion selectiva.

### Fase 4. Negocio Casa Ley

- Migrar Pedidos y Reporte Casa Ley.
- Endurecer coincidencias UUID/liberacion/asignacion.
- Cubrir con fixtures reales todas las categorias del Excel.

### Fase 5. Integracion del resto de modulos

- Cotizaciones, facturacion, documentos, reportes, WhatsApp y jobs.
- Eliminar estilos y shells legados al alcanzar paridad.

## Pruebas necesarias

- Unitarias para politicas, estados derivados y clasificaciones.
- Integracion para rutas y mutaciones por rol.
- Contratos API para cada DTO de pantalla.
- E2E para navegacion, recarga, atras/adelante, filtros y tiempo real.
- Accesibilidad automatizada mas recorridos manuales de teclado.
- Regresion visual en desktop y movil.
- Fixtures anonimizados de pedidos, pagos, trabajos, PC Estatal y capacitaciones.

## Conclusion

La logica de negocio no debe descartarse: Pedidos, sincronizacion local, empresas, capacitaciones y PC Estatal ya contienen avances valiosos. La inversion correcta es separar esa logica de la presentacion actual y convertir los patrones de Bolsa de Trabajo en un sistema de diseno y navegacion ejecutable.

El orden recomendado es primero permisos y contratos de datos, despues shell/componentes, y finalmente migracion por rutas. Empezar por cambiar colores o seguir agregando CSS al router monolitico produciria mejoras visibles de corta duracion y nuevas regresiones.

## Estado implementado el 28 de agosto de 2026

La primera entrega transversal de esta auditoria ya esta aplicada sobre el monolito actual. Se mantuvo el calendario como pagina principal en `/dashboard`.

### Fundacion y navegacion

- Shell compartido versionado `20260828a`, con topbar, menu por dominios y contexto de ruta.
- Calendario como primer enlace y vista predeterminada.
- Navegacion filtrada por capacidades del perfil autenticado.
- URLs persistentes para tabs y perfiles de empresa; recargar conserva la vista.
- Drawer accesible con foco, cierre por Escape, restauracion de foco y `aria-modal`.
- Encabezado, menu flotante y navegacion legacy ocultos cuando carga el shell nuevo.
- Todos los expansores se cierran al cargar salvo excepcion declarada.

### Permisos y notas

- Politica por puesto conectada a las rutas de lectura y mutacion.
- Lectura global separada de mutacion global.
- Gerente General conserva crear/editar global sin eliminar.
- Capacitador queda limitado a recursos propios donde lo exige el contrato.
- Notas persistentes como entradas de hilo con autor, fecha, edicion, eliminacion y menciones.
- La autorizacion valida el creador en backend; no depende solo de ocultar botones.

### Datos y tiempo real

- DTOs autenticados para `bootstrap`, calendario, capacitaciones, empresas, pedidos y notas.
- SSE compartido publica `desarrolloeg:data-changed` sin recargar toda la pagina.
- El calendario vuelve a consultar su DTO y reemplaza eventos en la instancia activa de FullCalendar.
- El indicador vivo se mantiene separado del boton principal de menu.
- La base SQLite local persistente sigue siendo la fuente de lectura de las vistas operativas.

### Negocio y regresiones cubiertas

- Coincidencias de asignaciones pagadas por identificador exacto, sin falsos positivos por subcadenas.
- Estados PC Estatal resueltos por sucursal, tienda e `ID_PC`.
- Estado enviado de pedidos persistente sin perder el resto de la fila.
- Precios base y variacion anual municipal cubiertos por pruebas.
- Perfil empresarial conserva filtros, agrupacion territorial y conteos dinamicos.
- Capacitaciones abren detalle integrado sin romper la ruta.
- Constancias conserva un workbench integrado en lugar de dos paginas visualmente pegadas.

### Verificacion ejecutada

- Suite Node: 38 pruebas aprobadas.
- Browser autenticado: calendario principal, datos visibles y ausencia de overlay de error.
- APIs: todas las rutas DTO verificadas con respuesta `200`.
- Navegacion: directorio en `?tab=sucursales` y perfil Casa Ley en `/dashboard/empresas/1`.
- Perfil Casa Ley verificado con 257 sucursales y expandibles cerrados.

La migracion futura a componentes React/TypeScript puede hacerse de manera incremental sobre estos contratos. No es requisito para que el shell, permisos, rutas, DTOs y tiempo real implementados funcionen en la version actual.
