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
- El flujo operativo queda: primero se despliega a `/QA`, luego QA aprueba, y despues se despliega a prod.

### QA-TKT-001 - Estabilizar `pedidos-native-sync`

- Prioridad: P0
- Area: Backend / Jobs
- Estado: Abierto para desarrollo
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
  - La cachÃ© caliente deja la segunda visita en tiempo casi inmediato.
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
  - Se agrego cachÃ© corta por filtros para evitar recalcular el mismo reporte.
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
- Estado: Abierto para desarrollo
- Problema:
  - El dashboard de administracion mezcla pestañas, chips y una rejilla grande de accesos sin una jerarquia de prioridad clara.
  - La pantalla se comporta mas como un lanzador de apps que como un tablero orientado a decisiones.
  - El usuario ve al mismo nivel estado general, gestion, pedidos y accesos directos a utilidades heterogeneas.
- Alcance:
  - Agrupar los accesos del dashboard por familias funcionales.
  - Destacar las acciones primarias y relegar utilidades secundarias a una zona menos competitiva visualmente.
  - Simplificar la navegacion interna para que no dependa de dos o tres niveles de seleccion al mismo tiempo.
  - Revisar si la barra movil, las tabs y la rejilla de rutas deben convivir o separarse mejor.
- Criterio de cierre:
  - El usuario identifica en segundos donde esta el resumen, donde estan las tareas operativas y donde estan los accesos secundarios.
  - El dashboard deja de sentirse saturado y gana una narrativa de uso mas guiada.
- Validacion QA:
  - La ruta `/dashboard` sigue protegiendose con login y no fue posible validar la experiencia admin completa sin sesion autenticada.
  - La estructura interna sigue mostrando tabs, barra movil y rejilla de rutas al mismo nivel, por lo que el ticket permanece abierto para ajuste de UX.

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

## Definicion de terminado

Un ticket se considera terminado cuando:

- el cambio esta implementado,
- existe prueba o evidencia de verificacion,
- la documentacion refleja el estado final,
- y el comportamiento anterior queda corregido o explicitamente justificado.

## Nota tecnica de ejecucion

- Se reforzo `facturacion/cotizacion/html` con un precalentamiento de catalogos en background para reducir el golpe inicial despues de despliegue.
- Se reforzo `SOLVENTACIONES/html` con cachÃ© de sesion y lecturas PCSinaloa para recortar trabajo repetido entre visitas cercanas.
- El ajuste complementa la cachÃ© corta por filtros ya documentada en `QA-TKT-006`.

