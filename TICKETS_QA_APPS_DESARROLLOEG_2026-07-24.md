# Tickets QA - apps.desarrolloeg.com

Fecha: 2026-07-24

Base de referencia:
- [Reporte QA actualizado](./src/modules/planeacion/public/assets/QA_REPORTE_APPS_DESARROLLOEG_2026-07-23.md)
- [Plan tecnico de solucion](./PLAN_SOLUCION_QA_APPS_DESARROLLOEG_2026-07-23.md)

## Criterio de trabajo

- `facturas-native-sync` queda en standby por credenciales y no entra al ciclo activo.
- El resto de tickets se documenta como cerrado o cerrado con observacion segun la evidencia en prod.
- Cada cierre debe quedar trazado en el reporte de QA y en el estado operativo del codigo.
- Los ambientes se separan por ruta: `https://apps.desarrolloeg.com` es prod y `https://apps.desarrolloeg.com/QA` es pruebas.
- El alias en minusculas `https://apps.desarrolloeg.com/qa` tambien entra al mismo ambiente de pruebas.
- El flujo operativo queda: primero se despliega a `/QA`, luego QA aprueba, y despues se despliega a prod.

### QA-TKT-001 - Estabilizar `pedidos-native-sync`

- Prioridad: P0
- Area: Backend / Jobs
- Estado: Cerrado en prod
- Dependencias: medicion real de timeout, trazas de error, validacion de payload
- Problema:
  - El job presentaba abortos por timeout o latencia externa.
- Alcance:
  - Verificar si 30s cubria el peor caso.
  - Ajustar timeout o reintentos solo con evidencia.
  - Confirmar que el job dejara de fallar de forma recurrente.
- Cierre:
  - Se elevo el timeout de fetch para absorber la latencia real.
  - Se redujo la agresividad de reintentos para evitar ciclos innecesarios.
  - `jobs/health` ya no reporta `pedidos-native-sync` como falla activa.
  - Se revalido en prod con `POST /jobs/pedidos-native-sync/run` exitoso y `jobs/health` en `200`.
- Validacion QA:
  - En la revision local del `2026-07-27`, `GET /jobs/health` respondio `200` con `failingJobs: 0`.
  - La corrida manual de `POST /jobs/pedidos-native-sync/run` completo con `ok: true`, `code: 0` y resultado operativo.

### QA-TKT-002 - Alinear despliegue productivo con el codigo validado

- Prioridad: P0
- Area: DevOps / Backend
- Estado: Cerrado en prod
- Dependencias: commit desplegado, build publicado, reinicio real del contenedor o proceso
- Problema:
  - QA necesitaba garantizar que prod sirviera la misma version validada localmente.
- Alcance:
  - Confirmar SHA o version del build en prod.
  - Verificar que las rutas nuevas existan en productivo.
  - Exponer version o commit en `health` o `status` si aun no existe.
- Cierre:
  - El release responde con identificador de version y SHA en `health`.
  - Se confirmo la misma version en prod despues del rebuild y reinicio del contenedor.
  - Las rutas corregidas quedaron disponibles en productivo.

### QA-TKT-003 - Reducir la primera carga de `facturacion/cotizacion/html`

- Prioridad: P1
- Area: Frontend / Backend
- Estado: Cerrado en prod con observacion
- Dependencias: trazas de carga, analisis de payload, deteccion de cuello de botella
- Problema:
  - Era la ruta mas lenta y la mayor friccion para usuario final.
- Alcance:
  - Medir backend, render, consultas y assets.
  - Reducir trabajo inicial no critico.
  - Introducir feedback de carga si la mejora completa no era posible de inmediato.
- Cierre:
  - Se elimino trabajo bloqueante en la respuesta inicial.
  - La cachÃƒÆ’Ã‚Â© caliente deja la segunda visita en tiempo casi inmediato.
  - La primera visita sigue siendo costosa y queda documentada como costo de calentamiento.

### QA-TKT-004 - Consolidar la experiencia de `jobs/view`

- Prioridad: P1
- Area: Frontend / Arquitectura
- Estado: Cerrado en prod
- Dependencias: definicion de contrato tecnico vs operativo
- Problema:
  - La vista ya existia, pero aun podia sentirse cargada y poco jerarquizada.
- Alcance:
  - Definir si `jobs` queda tecnico y `jobs/view` operativo.
  - Reducir sobrecarga visual.
  - Priorizar una accion primaria por bloque.
- Cierre:
  - `jobs/view` ya opera como panel operativo.
  - La vista y los estados de jobs quedaron separados de forma mas clara.
  - La experiencia de acciones principales quedo jerarquizada.

### QA-TKT-005 - Cerrar navegacion de WhatsApp Capacitadores

- Prioridad: P1
- Area: Frontend
- Estado: Cerrado en prod
- Dependencias: landing base, enlaces de retorno, coherencia visual
- Problema:
  - La experiencia ya mejoro, pero debia quedar redonda y consistente.
- Alcance:
  - Mantener una CTA principal unica.
  - Asegurar retorno visible desde `/whatsapp-capacitadores/qr`.
  - Homogeneizar el lenguaje visual con el portal.
- Cierre:
  - La navegacion de retorno ya quedo visible y operativa.
  - La vista conserva una salida clara a landing o health.
  - La experiencia quedo consistente con el portal.

### QA-TKT-006 - Reducir la latencia percibida de `SOLVENTACIONES/html`

- Prioridad: P1
- Area: Frontend / Backend
- Estado: Cerrado en prod con observacion
- Dependencias: medicion de payload y render
- Problema:
  - Era una ruta sensible para experiencia de usuario.
- Alcance:
  - Revisar si el costo estaba en red, render o procesamiento.
  - Agregar feedback de carga si no se podia reducir suficiente de inmediato.
- Cierre:
  - Se agrego cachÃƒÆ’Ã‚Â© corta por filtros para evitar recalcular el mismo reporte.
  - La segunda visita ya baja de forma fuerte.
  - La primera visita sigue siendo pesada y queda como observacion de performance.

### QA-TKT-007 - Documentar fuente de verdad y rol de CSV en Planeacion

- Prioridad: P2
- Area: Arquitectura / QA
- Estado: Cerrado documentalmente
- Dependencias: criterio funcional confirmado por negocio
- Problema:
  - Aun podia haber confusion entre AppSheet, CSV y soporte legacy.
- Alcance:
  - Dejar explicito que AppSheet es la fuente de verdad operativa.
  - Documentar CSV como soporte de migracion o legado.
  - Definir si `csvStore.js` sigue vivo o queda en retiro controlado.
- Cierre:
  - El reporte deja explicita la fuente de verdad operativa.
  - CSV queda documentado como soporte de migracion o legado.
  - La ambiguedad de criterio ya quedo resuelta a nivel documental.

### QA-TKT-008 - Ajustar fallback accesible de Planeacion

- Prioridad: P2
- Area: Frontend
- Estado: Cerrado en prod
- Dependencias: shell SPA, estructura semantica, mensaje inicial visible
- Problema:
  - La shell dependia del cliente y convenia reforzar el contexto inicial.
- Alcance:
  - Mantener `main`, heading y mensaje inicial visibles.
  - Reforzar el estado de carga cuando el cliente aun no hidrata.
- Cierre:
  - La shell ya comunica contexto aun antes de completar la carga.
  - El fallback accesible quedo reforzado en productivo.

## Ticket en standby

### QA-TKT-009 - `facturas-native-sync`

- Prioridad: P1
- Area: Backend / Operaciones
- Estado: Cerrado en prod
- Motivo:
  - El problema identificado era de login/credenciales de ClubFactura.
- Decision:
  - Validar el login con credenciales reales y dejar el job listo para operacion.
- Validacion:
  - `loginClubFactura()` responde con token usando las credenciales confirmadas por Operaciones.
  - `iniciarSesionWeb()` completa el acceso web sin error con el mismo contexto.
- Cierre:
  - Se confirmo que el bloqueo era de acceso y no de logica del job.
  - El job `facturas-native-sync` deja de permanecer en standby una vez validadas las credenciales.
  - La configuracion de entorno quedo alineada con las credenciales comprobadas.

## Tickets resueltos

### QA-TKT-010 - Mostrar el QR para reconectar el bot de WhatsApp

- Prioridad: P1
- Area: Frontend / Integracion
- Estado: Cerrado en prod
- Dependencias: generacion del QR, asset disponible, render del bloque visual
- Problema:
  - La ruta `/whatsapp-capacitadores/qr` responde bien, pero no muestra el QR grafico necesario para reconectar el bot.
  - Para QA y operacion, esto deja la experiencia a medias aunque existan enlaces de retorno.
- Alcance:
  - Confirmar de donde debe venir el QR de reconexion.
  - Mostrar la imagen o fallback visible en la pantalla de QR.
  - Mantener los enlaces de regreso a landing y health.
- Cierre esperado:
  - El usuario ve el QR de reconexion sin depender de pasos extra.
  - La pantalla de WhatsApp Capacitadores QR permite volver a enlazar el bot de forma clara.
- Cierre:
  - La vista `/whatsapp-capacitadores/qr` ahora incrusta el QR cuando esta disponible.
  - Si el QR aun no existe, la pantalla muestra un estado vacio explicito y util, en lugar de dejar una vista ambigua.
  - Se mantienen los enlaces de retorno a inicio y health.

## Resumen de cierre

- Tickets cerrados en prod: `QA-TKT-001`, `QA-TKT-002`, `QA-TKT-004`, `QA-TKT-005`, `QA-TKT-007`, `QA-TKT-008`.
- Tickets cerrados con observacion de performance: `QA-TKT-003`, `QA-TKT-006`.
- Ticket en standby: `QA-TKT-009`.
- Ticket cerrado en prod: `QA-TKT-010`.
- Ticket cerrado en prod: `QA-TKT-016`.
- El foco restante ya no es una falla operativa activa, sino la optimizacion futura de la primera carga en pantallas pesadas.
- `QA-TKT-001` quedo revalidado despues del ajuste de timeout y ya no presenta regresion operativa.

## Tickets de desarrollo UI/UX

### QA-TKT-011 - Diferenciar portal, login y dashboard

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - La portada, el login y el dashboard comparten demasiada cercania visual y conceptual.
  - El usuario puede no entender con rapidez donde empieza la autentificacion y donde termina el acceso inicial.
- Alcance:
  - Diferenciar mas claramente el portal de acceso, la pantalla de login y el dashboard principal.
  - Revisar titulo, copy y jerarquia visual para que cada pantalla comunique un proposito unico.
  - Mantener branding consistente sin repetir la misma idea de acceso en tres superficies distintas.
- Criterio de cierre:
  - Un usuario sin contexto identifica en menos de un vistazo si esta en portal, login o dashboard.
- Cierre:
  - `renderLoginPage` ahora diferencia el portal de acceso, la entrada con Google y el tablero posterior.
  - El dashboard paso a `Tablero personal` / `Tablero general` para separar mejor la idea de acceso de la de operacion.

### QA-TKT-012 - Reducir densidad visual de `jobs/view` y `jobs/pedidos/manual`

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - Las vistas de Jobs concentran demasiadas acciones visibles, enlaces y formularios.
  - La carga cognitiva sube porque la jerarquia no siempre deja claro que hacer primero.
- Alcance:
  - Reordenar acciones para priorizar una ruta principal por bloque.
  - Agrupar o colapsar opciones secundarias donde no aporten valor inmediato.
  - Hacer mas evidente la diferencia entre vista tecnica y flujo operativo.
- Criterio de cierre:
  - La pantalla permite identificar accion principal, accion secundaria y retorno sin escanear demasiado.
- Cierre:
  - `jobs/view` ahora muestra el detalle tecnico dentro de `details` para bajar la densidad visual.
  - `jobs/pedidos/manual` quedo compactado con copy mas corto y un arranque semantico mas claro.

### QA-TKT-013 - Simplificar el tablero de `status`

- Prioridad: P2
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - `status` concentra mucha informacion en una sola vista y se siente mas tecnica que ejecutiva.
  - El usuario debe leer demasiado para distinguir el estado real del sistema.
- Alcance:
  - Separar con mayor claridad resumen ejecutivo y detalle operativo.
  - Priorizar los indicadores que realmente ayudan a decidir primero.
  - Reducir ruido visual en tarjetas, secciones y enlaces no esenciales.
- Criterio de cierre:
  - El tablero permite entender el estado general sin leer todo el contenido tecnico.
- Cierre:
  - La vista de `status` quedo resumida con tres bloques principales y un desplegable para legado y procesos retirados.
  - La accion secundaria paso a un lenguaje mas directo para que el tablero se lea con menos friccion.

### QA-TKT-014 - Homogeneizar microcopy, botones y estados vacios

- Prioridad: P2
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - Cada modulo usa variaciones distintas para botones, mensajes de estado y llamadas a la accion.
  - Eso debilita la sensacion de sistema unificado.
- Alcance:
  - Estandarizar tono de mensajes, labels de botones y estados vacios.
  - Alinear copy de carga, error y retorno con un mismo lenguaje de producto.
  - Evitar que cada modulo parezca una app distinta.
- Criterio de cierre:
  - Los mensajes y CTAs del portal siguen una misma voz y una misma jerarquia.
- Cierre:
  - Se normalizaron varios labels de accion y descripciones en portal, jobs y status.
  - Se redujo el ruido de texto en las superficies operativas mas visibles.

### QA-TKT-015 - Replicar estructura accesible base en utilidades que lo permitan

- Prioridad: P2
- Area: Frontend / Accesibilidad
- Estado: Cerrado en prod
- Problema:
  - Planeacion ya muestra un patron mejor resuelto con `main`, `h1` y `skip-link`.
  - Otras utilidades no siempre exponen ese arranque semantico con la misma calidad.
- Alcance:
  - Llevar el patron accesible de Planeacion a pantallas que hoy dependan demasiado del cliente o de estructuras menos claras.
  - Revisar headings, landmarks y acceso por teclado en vistas clave.
  - Mantener un inicio visible y un salto directo al contenido principal cuando aplique.
- Criterio de cierre:
  - Las superficies prioritarias exponen una estructura semantica clara desde el primer render.

### QA-TKT-016 - Mantener persistente la sesion de WhatsApp Capacitadores

- Prioridad: P1
- Area: Backend / Integracion / Operaciones
- Estado: Cerrado en prod
- Problema:
  - Cada despliegue esta cerrando la sesion del bot de WhatsApp.
  - La operacion necesita que la sesion se conserve activa lo mas posible y solo se cierre de forma manual cuando se quiera cambiar de dispositivo o forzar una reconexion.
- Alcance:
  - Revisar que proceso o reinicio invalida la sesion.
  - Evitar que el deploy destruya la sesion cuando no es necesario.
  - Mantener la sesion persistente entre reinicios normales del servicio.
  - Definir un flujo manual claro para cerrar la sesion solo cuando operacion lo solicite.
- Criterio de cierre:
  - Un despliegue normal no rompe la sesion de WhatsApp.
  - La sesion solo se cierra por accion manual o por una causa operativa justificada.
- Cierre:
  - El apagado normal del servicio marca el cierre como intencional y evita limpiar la sesion de WhatsApp.
  - La ruta manual de QR sigue siendo la unica que borra la carpeta de sesion para forzar una reconexion limpia.
  - La carpeta de sesion persiste en el volumen de runtime y sobrevivio al redeploy de validacion.

### QA-TKT-017 - Corregir textos corruptos en `jobs/pedidos/manual`

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - La vista manual de pedidos sigue mostrando mojibake en mensajes de error y estado.
  - La pantalla ya tiene mejor estructura semantica, pero el texto corrupto degrada la percepcion de calidad.
- Alcance:
  - Corregir la codificacion de los mensajes de estado y error en la vista de pedidos manual.
  - Verificar que los textos publicados en prod se rendericen con acentos correctos y sin mojibake.
  - Mantener la estructura guiada y los accesos visibles ya atendidos.
- Criterio de cierre:
  - `jobs/pedidos/manual` muestra todos sus mensajes en texto correcto y legible en productivo.
- Cierre:
  - Se corrigio el copy roto en la vista manual de pedidos y en sus mensajes de espera, error y confirmacion.
  - La pantalla conserva la estructura guiada, el `skip-link` y los accesos visibles ya resueltos.
  - La experiencia ya no expone mojibake en el flujo de captura y envio.

### QA-TKT-018 - Reorganizar el dashboard admin por familias y prioridad

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - El dashboard de administracion mezclaba pestañas, chips y una rejilla grande de accesos sin una jerarquia de prioridad clara.
  - La pantalla se comportaba mas como un lanzador de apps que como un tablero orientado a decisiones.
  - El usuario veia al mismo nivel estado general, gestion, pedidos y accesos directos a utilidades heterogeneas.
- Alcance:
  - Agrupar los accesos del dashboard por familias funcionales.
  - Destacar las acciones primarias y relegar utilidades secundarias a una zona menos competitiva visualmente.
  - Simplificar la navegacion interna para que no dependa de dos o tres niveles de seleccion al mismo tiempo.
  - Revisar si la barra movil, las tabs y la rejilla de rutas deben convivir o separarse mejor.
- Criterio de cierre:
  - El usuario identifica en segundos donde esta el resumen, donde estan las tareas operativas y donde estan los accesos secundarios.
  - El dashboard deja de sentirse saturado y gana una narrativa de uso mas guiada.
- Validacion QA:
  - En la revision local del `2026-07-27`, el dashboard admin paso a mostrar una tab inicial de calendario seguida por la gestion, pedidos y las utilidades secundarias.
  - La seccion de accesos internos ahora separa `Acciones principales` y `Utilidades secundarias` para reducir la competencia visual.
  - En la revision viva del `2026-07-27`, el dashboard general sigue exponiendo esa separacion y responde con una jerarquia mas clara que la version anterior.

### QA-TKT-019 - Corregir textos corruptos en las tarjetas del dashboard

- Prioridad: P2
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - Varias tarjetas del dashboard admin muestran mojibake en titulos y descripciones, por ejemplo `Planeacion Ley`, `Generacion` y `Facturacion`.
  - El problema no rompe la navegacion, pero baja la percepcion de calidad y confianza del tablero.
- Alcance:
  - Corregir la codificacion de los textos visibles en la rejilla de accesos del dashboard.
  - Verificar que acentos, enes y caracteres especiales se rendericen correctamente en productivo.
  - Revisar si el origen del error esta en el literal de datos, la serializacion o la respuesta HTML final.
- Criterio de cierre:
  - Ninguna tarjeta del dashboard muestra texto corrupto y todo el copy se lee correctamente.
- Cierre:
  - Se corrigieron los textos visibles del portal y de las tarjetas principales del acceso.
  - Los titulos y descripciones ahora se renderizan con acentos correctos y sin mojibake.
  - El copy del sistema vuelve a leerse de forma consistente en las superficies de acceso.

### QA-TKT-020 - Solicitar acceso autenticado de QA para validar dashboard admin

- Prioridad: P1
- Area: QA / Frontend / Soporte
- Estado: Cerrado en prod
- Problema:
  - El dashboard admin no puede validarse de extremo a extremo sin una sesion autenticada.
  - La ruta `/dashboard` redirige a login y no expone el flujo real de tabs, barra movil y accesos del tablero admin desde el entorno de pruebas.
  - Para hacer QA como usuario final necesitamos un contexto autenticado estable y reproducible.
- Alcance:
  - Proporcionar una cuenta de prueba con rol admin o un mecanismo equivalente para entrar al dashboard sin bloquearse en login.
  - Asegurar que la sesion de QA permita revisar navegacion, jerarquia visual, copy, estados vacios y accesos internos del dashboard.
  - Si se usa sesion temporal, definir su vigencia y el modo correcto de renovarla para pruebas repetibles.
  - Documentar cualquier restriccion de acceso que impida validar el flujo completo.
- Criterio de cierre:
  - QA puede entrar al dashboard admin y recorrerlo como usuario final sin depender de redirecciones manuales o sesiones personales.
  - El equipo de pruebas puede validar tabs, barra movil, rejilla de rutas y estados del dashboard en productivo o en un entorno equivalente.
- Validacion QA:
  - Se agrego un acceso QA controlado en la pantalla de login, protegido por token y desactivado por defecto.
  - El acceso genera una sesion firmada y permite abrir el dashboard admin sin tocar el flujo normal de Google.
  - La configuracion queda documentada en `README.md` y en `.env.example` para que QA y operaciones la activen cuando sea necesario.
- Cierre:
  - Se habilito un acceso temporal de QA para validar el dashboard admin sin depender de sesiones personales.
  - El flujo normal de autenticacion corporativa sigue intacto y el acceso QA queda aislado por configuracion.
  - El ticket queda cerrado con documentacion del cambio para repetir la validacion cuando haga falta.

### QA-TKT-021 - Evitar guardar facturas canceladas en ClubFactura

- Prioridad: P1
- Area: Backend / Integracion / Facturas
- Estado: Cerrado en prod
- Problema:
  - Se guardo en AppSheet una factura que ya debia estar cancelada.
  - El caso confirmado corresponde al folio `660` de `SERGIO GONZALEZ CASTILLO`, con UUID `ba0e5850-0915-4e7d-beaf-f2a2f3116f06`.
  - El sincronizador actual toma las facturas devueltas por ClubFactura y las manda a AppSheet sin un filtro explicito de cancelacion.
- Alcance:
  - Agregar una validacion antes de persistir para omitir facturas canceladas o anuladas.
  - Revisar si ClubFactura expone un campo de estado adicional que permita filtrar antes del `AddOrUpdate`.
  - Asegurar que el job no vuelva a guardar en AppSheet un registro cancelado aunque siga apareciendo en la consulta origen.
  - Definir una traza o evidencia que permita distinguir canceladas de emitidas en futuras revisiones QA.
- Criterio de cierre:
  - Una factura cancelada no se guarda en AppSheet.
  - El flujo de sincronizacion registra claramente por que una factura fue omitida.
- Validacion QA:
  - El registro ya existe en AppSheet con `serieFolio` 660 y `estatusPagoDesc` "Pendiente cobrar", lo que confirma que el flujo actual la persistio sin filtrar cancelacion.
  - `estatusCancelacion` ya se usa como filtro y las facturas canceladas se excluyen antes de persistir.
  - El job escribe `cfdis_cancelled.csv` con evidencia de las facturas omitidas para QA y operacion.
  - El mismo flujo ejecuta `Delete` contra AppSheet para borrar las facturas canceladas que ya estaban guardadas y deja `cfdis_cancelled_deleted.csv` como traza de auditoria.
  - Se agrego una prueba que valida el filtro de cancelacion con casos positivos y negativos.
  - Se ejecuto la limpieza historica el `2026-07-25` sobre ClubFactura y se eliminaron `3` facturas canceladas que seguian guardadas en AppSheet.
- Cierre:
  - El flujo de sincronizacion deja de persistir facturas canceladas, borra las ya guardadas en AppSheet y conserva evidencia de lo omitido.
  - La proteccion por credenciales faltantes sigue vigente como hardening adicional del mismo job.
  - El ticket queda cerrado con evidencia automatizada y sin repetir el caso de AppSheet.

### QA-TKT-022 - Corregir encoding y accesibilidad de `dashboard/pedidos`

- Prioridad: P2
- Area: Frontend / UX / Accesibilidad
- Estado: Cerrado en prod
- Problema:
  - La ruta `/dashboard/pedidos` respondia `200`, pero el copy visible seguia mostrando mojibake en la medicion de QA mas reciente.
  - La vista no exponia `skip-link` ni una salida semantica tan clara como otras superficies del portal.
- Alcance:
  - Corregir el encoding del texto visible en el modulo.
  - Agregar landmarks, heading principal y un salto accesible al contenido.
  - Revisar si la pantalla necesita un regreso mas claro hacia el dashboard general.
- Criterio de cierre:
  - La pantalla se lee sin caracteres corruptos.
  - La navegacion por teclado y lector de pantalla queda clara.
  - La vista ofrece un regreso claro al dashboard padre.
- Validacion QA:
  - En la revision del `2026-07-27`, la vista ya incorpora `skip-link`, `main` y un regreso claro al dashboard padre.
  - El encoding visible quedo alineado con el resto del portal en la version desplegada.

### QA-TKT-023 - Corregir encoding visible de `SOLVENTACIONES/html`

- Prioridad: P2
- Area: Frontend / UX / Accesibilidad
- Estado: Cerrado en QA
- Problema:
  - `SOLVENTACIONES/html` seguia respondiendo, pero la revision de QA detectaba mojibake visible en mediciones anteriores.
  - La vista ademas mantenia friccion visual y no ofrecia una lectura tan limpia como otras utilidades del portal.
- Alcance:
  - Corregir la codificacion de los textos visibles.
  - Revisar si el render final o la fuente de datos estan introduciendo el problema.
  - Mantener la mejora de performance ya documentada sin romper la navegacion actual.
- Criterio de cierre:
  - La pantalla se lee correctamente, sin caracteres corruptos.
  - El contenido conserva su respuesta rapida y su estructura actual.
- Validacion QA:
  - En la revision del `2026-07-27`, el texto visible ya se lee limpio en el flujo renderizado.
  - La disponibilidad se mantiene y la lectura ya no presenta caracteres corruptos visibles.

### QA-TKT-024 - Homogeneizar el lenguaje visual entre dashboard y utilidades

- Prioridad: P1
- Area: Frontend / UX / Diseno
- Estado: Cerrado en prod
- Problema:
  - El dashboard general y las utilidades del portal no se sentian como partes de la misma app.
  - Cada modulo parecia construido con una base visual distinta y luego pegado al sistema sin unificar jerarquia, espaciado, componentes o tono visual.
  - La navegacion entre dashboard, status, WhatsApp, Planeacion, Facturacion y Solventaciones se percibia brusca.
- Alcance:
  - Unificar tipografia, paleta, radios, sombras, botones y chips en las superficies principales.
  - Establecer un lenguaje visual comun para tarjetas, encabezados, estados vacios y acciones primarias.
  - Reducir la sensacion de salto entre dashboard y utilidades.
  - Alinear los puntos de entrada para que todas las herramientas parezcan parte del mismo sistema.
- Criterio de cierre:
  - El usuario percibe una sola app, no una coleccion de pantallas pegadas.
  - El salto entre dashboard y utilidades se siente continuo y consistente.
- Validacion QA:
  - En la revision del 2026-07-27, las superficies clave ya cargan una hoja visual compartida en /ui/portal-shell.css.
  - status, whatsapp-capacitadores, Planeacion-ley/, facturacion/cotizacion/html y SOLVENTACIONES/html ya usan la misma base de shell y componentes.
  - La coherencia visual quedo alineada al mismo vocabulario de portal.

### QA-TKT-025 - Definir tokens visuales comunes del portal

- Prioridad: P1
- Area: Frontend / Design System
- Estado: Cerrado en prod
- Problema:
  - Cada superficie usaba variantes distintas de color, radio, sombra, espaciado y peso tipografico.
  - La falta de tokens compartidos hacia que el portal se percibiera como un conjunto de piezas no estandarizadas.
- Alcance:
  - Definir una paleta y escala de estados compartida por dashboard y utilidades.
  - Estandarizar radios, sombras, bordes, espaciados y tipografia base.
  - Exponer tokens reutilizables para cards, botones, chips y superficies de carga.
- Criterio de cierre:
  - Las superficies principales consumen la misma base visual sin reinventar colores o tamanos por modulo.
  - El sistema visual queda documentado como referencia unica.
- Validacion QA:
  - En la revision de diseno del 2026-07-27, los tokens base ya se distribuyen desde /ui/portal-shell.css.
  - El dashboard y las utilidades principales comparten ahora la misma base de color, radio, sombra y componentes.

### QA-TKT-026 - Unificar la shell comun de las superficies principales

- Prioridad: P1
- Area: Frontend / UX / Arquitectura visual
- Estado: Cerrado en prod
- Problema:
  - Las superficies principales no compartian una shell consistente de header, hero, contenido y regreso.
  - Algunas vistas parecian paginas completas del sistema y otras parecian widgets aislados.
- Alcance:
  - Reutilizar una estructura comun con hero, main, skip-link, loader y regreso visible.
  - Alinear la jerarquia inicial de portal, login, dashboard y utilidades.
  - Reducir la sensacion de salto abrupto entre pantallas.
- Criterio de cierre:
  - El usuario reconoce la misma estructura base en todo el portal.
  - La navegacion entre pantallas se siente continua y no como cambio de app.
- Validacion QA:
  - En la revision del 2026-07-27, dashboard, WhatsApp, Planeacion, Facturacion y Solventaciones ya comparten la misma clase base de portal y la hoja comun de shell.
  - El recorrido entre superficies queda mas continuo y con retorno semantico consistente.

### QA-TKT-027 - Estandarizar botones, cards, chips y loaders

- Prioridad: P1
- Area: Frontend / UI
- Estado: Cerrado en prod
- Problema:
  - Los componentes interactivos cambiaban de forma y peso entre modulos.
  - Buttons, chips, cards y loaders no seguian un sistema consistente y eso rompia la continuidad visual.
- Alcance:
  - Unificar variantes de primary, secondary y ghost.
  - Normalizar cards, chips de estado, loaders y estados vacios.
  - Aplicar los mismos patrones en dashboard y utilidades.
- Criterio de cierre:
  - Botones y estados se ven y se comportan igual en todo el portal.
  - El usuario no siente que cada modulo inventa su propio sistema de interaccion.
- Validacion QA:
  - En la revision del 2026-07-27, la hoja comun ya estandariza botones, cards, pills y chips en las superficies alineadas.
  - Las utilidades principales adoptan la misma base de interaccion que el resto del portal.

### QA-TKT-028 - Alinear WhatsApp Capacitadores y Planeacion al lenguaje del dashboard

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en prod
- Problema:
  - WhatsApp Capacitadores y Planeacion tenian buenas soluciones funcionales, pero su presentacion visual no hablaba el mismo idioma que el dashboard.
  - Ambas superficies se sentian mas como herramientas especificas que como partes organicas del portal.
- Alcance:
  - Llevarles el mismo tratamiento de encabezado, botones, cards, tipografia y espaciado que al dashboard.
  - Mantener su funcion operativa sin alterar flujos ya resueltos.
  - Evitar que parezcan productos independientes.
- Criterio de cierre:
  - WhatsApp y Planeacion conservan su identidad funcional pero se leen como parte del mismo sistema.
  - La navegacion entre dashboard, WhatsApp y Planeacion se siente homogenea.
- Validacion QA:
  - En la revision del 2026-07-27, whatsapp-capacitadores y Planeacion-ley/ ya comparten la base visual del portal y el mismo enfoque de shell.
  - Ambas superficies conservan su identidad funcional sin desentonar frente al dashboard.

### QA-TKT-029 - Alinear Facturacion y Solventaciones al lenguaje visual del portal

- Prioridad: P1
- Area: Frontend / UX
- Estado: Cerrado en QA
- Problema:
  - `facturacion/cotizacion/html` y `SOLVENTACIONES/html` todavia no se sienten integradas con la misma fuerza visual y semantica que el resto del portal.
  - `SOLVENTACIONES/html` ya no muestra mojibake visible, pero sigue necesitando una estructura mas clara para no sentirse como una pieza suelta.
- Alcance:
  - Revestir ambas superficies con la misma shell, jerarquia y componentes base del portal.
  - Reducir la distancia visual frente al dashboard y el resto de utilidades.
  - Mantener el enfoque en operacion y reporte sin sacrificar coherencia.
- Criterio de cierre:
  - Facturacion y Solventaciones parecen parte del mismo producto que el dashboard.
  - El usuario deja de percibirlas como pantallas ajenas al portal principal.
- Validacion QA:
  - En la actualizacion de codigo del `2026-07-27`, `facturacion/cotizacion/html` y las plantillas de cotizacion asociadas, junto con `SOLVENTACIONES/html`, ya exponen `skip-link`, `main` y un regreso visible al dashboard.
  - La base visual y la semantica de navegacion quedaron alineadas con el resto del portal.
  - Queda pendiente la revalidacion en entorno desplegado.

### QA-TKT-030 - Homogeneizar visualmente `dashboard/pedidos`

- Prioridad: P2
- Area: Frontend / UX / Navegacion
- Estado: Cerrado en QA
- Problema:
  - `dashboard/pedidos` ya es accesible y funcional, pero visualmente sigue sintiendose un poco aparte del resto del portal.
  - La pantalla no termina de heredar la misma personalidad visual que `dashboard`, `status` y `whatsapp-capacitadores`.
- Alcance:
  - Alinear contenedores, espaciado y jerarquia visual con el shell comun.
  - Revisar si debe heredar una clase base de portal para evitar que el body quede visualmente desnudo.
  - Hacer mas suave el regreso al dashboard padre.
- Criterio de cierre:
  - La pantalla se percibe como una extension natural del dashboard, no como una vista suelta.
- Validacion QA:
  - En la actualizacion de codigo del `2026-07-27`, la vista ya adopta `portal-shell`, `portal-pedidos`, `main` y `skip-link`, ademas de la hoja comun de shell.
  - La pantalla deja de sentirse aislada a nivel de estructura y coherencia visual.
  - Queda pendiente la revalidacion en entorno desplegado.

### QA-TKT-031 - Completar semantica y retorno accesible en `facturacion/cotizacion/html`

- Prioridad: P2
- Area: Frontend / UX / Accesibilidad
- Estado: Cerrado en QA
- Problema:
  - `facturacion/cotizacion/html` ya adopto la hoja compartida, pero el flujo sigue sintiendose mas tecnico que portal.
  - La superficie no expone `main` ni `skip-link`, lo que baja la calidad del recorrido con teclado y lector de pantalla.
- Alcance:
  - Agregar landmarks semanticos y un salto accesible al contenido.
  - Revisar el regreso visual a la ruta padre.
  - Mantener la identidad operativa sin perder coherencia con el resto del sistema.
- Criterio de cierre:
  - La pantalla se navega con mas claridad y sin friccion innecesaria.
- Validacion QA:
  - En la actualizacion de codigo del `2026-07-27`, la vista incorpora `skip-link`, `main` y un regreso claro al dashboard.
  - La navegacion por teclado y la lectura semantica quedan resueltas a nivel de implementacion.
  - Queda pendiente la revalidacion en entorno desplegado.

`QA-TKT-032` fue consolidado dentro de `QA-TKT-029` para evitar duplicidad de backlog.

### QA-TKT-033 - Asegurar la publicacion de `portal-shell.css` en despliegue

- Prioridad: P1
- Area: Frontend / Release / Infra
- Estado: Cerrado en QA
- Problema:
  - La hoja compartida `portal-shell.css` ya unifica la base visual de varias superficies, pero depende de que el archivo nuevo viaje correctamente en cada despliegue.
  - Si el asset no queda incluido en el paquete final, las paginas que lo referencian pueden caer en 404 y perder la capa visual comun.
- Alcance:
  - Asegurar que `src/public/ui/portal-shell.css` forme parte del repositorio y del artefacto de despliegue.
  - Validar que el mount `/ui` siga sirviendo la hoja compartida en el entorno productivo.
  - Confirmar que las superficies que la consumen no dependan de archivos locales no versionados.
- Criterio de cierre:
  - `portal-shell.css` responde `200` en prod y todas las superficies objetivo lo cargan sin depender del estado del worktree.
  - El despliegue queda reproducible con la misma capa visual compartida.
- Validacion QA:
  - En la revision local del `2026-07-27`, la ruta `/ui/portal-shell.css` responde `200` y las superficies principales la cargan correctamente.
  - El rebuild del contenedor `monolito` ya incluye el asset y mantiene la hoja compartida disponible.

### QA-TKT-034 - Estabilizar el entrypoint de Planeacion sin depender de un shim fragil

- Prioridad: P2
- Area: Frontend / Build / Planeacion
- Estado: Cerrado en QA
- Problema:
  - `Planeacion-ley/` hoy arranca mediante un archivo shim que solo reexporta otro bundle generado.
  - Esa dependencia indirecta hace mas facil que una regeneracion o limpieza de assets rompa el acceso sin que el cambio principal lo anticipe.
- Alcance:
  - Reemplazar el shim por una estrategia de build mas estable y explicita.
  - Documentar el contrato entre el HTML de Planeacion y sus assets generados.
  - Evitar que el arranque dependa de nombres intermedios poco claros o de una cadena de importacion innecesaria.
- Criterio de cierre:
  - Planeacion sigue abriendo despues de un rebuild limpio y no depende de un archivo intermedio para bootear.
  - La relacion entre HTML, JS y CSS queda clara para mantenimiento futuro.
- Validacion QA:
  - En la revision local del `2026-07-27`, `Planeacion-ley/` ya carga directamente el bundle estable `index-planeacion-20260603d.js`.
  - Tras reconstruir `monolito`, la ruta sigue respondiendo `200` y ya no depende del shim `index-DXGJThHF.js` como entrada principal.

## Definicion de terminado

Un ticket se considera terminado cuando:

- el cambio esta implementado,
- existe prueba o evidencia de verificacion,
- la documentacion refleja el estado final,
- y el comportamiento anterior queda corregido o explicitamente justificado.

## Nota tecnica de ejecucion

- Se reforzo `facturacion/cotizacion/html` con un precalentamiento de catalogos en background para reducir el golpe inicial despues de despliegue.
- Se reforzo `SOLVENTACIONES/html` con cachÃƒÆ’Ã‚Â© de sesion y lecturas PCSinaloa para recortar trabajo repetido entre visitas cercanas.
- El ajuste complementa la cachÃƒÆ’Ã‚Â© corta por filtros ya documentada en `QA-TKT-006`.

