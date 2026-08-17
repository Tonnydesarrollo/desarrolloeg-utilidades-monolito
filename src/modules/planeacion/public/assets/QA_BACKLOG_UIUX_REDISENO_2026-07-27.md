# Backlog UI/UX - Desarrollo EG

Fecha: 2026-07-27

Origen de la revision:
- QA en `https://apps.desarrolloeg.com/QA`
- Validacion de redireccion desde `/dashboard` hacia `/login`
- Revision del reporte QA local `QA_REPORTE_APPS_DESARROLLOEG_2026-07-23.md`

## Objetivo

Redisenar la experiencia del portal para que todas las superficies del proyecto se sientan parte del mismo sistema, con el dashboard como punto de entrada principal y con una jerarquia visual mas clara en cada modulo.

## Criterios globales de redisenio

- Una sola base visual compartida para portal, login, dashboard y modulos.
- Una accion principal por pantalla o bloque.
- Retorno visible y consistente al dashboard o a la pantalla padre.
- Estados vacios, de carga y de error con el mismo lenguaje visual.
- Accesibilidad base: `main`, `h1`, contraste correcto, foco visible y navegacion por teclado.
- Menor carga cognitiva en pantallas con muchas rutas o utilidades.

## Tickets propuestos

### QA-033 - Redisenar el dashboard principal como home autenticada

Tipo: UX/UI
Prioridad: Alta

Descripcion:
- Convertir el dashboard en una home realmente orientadora.
- Separar claramente el contenido en bloques como `Acciones principales`, `Operacion`, `Administracion` y `Utilidades`.
- Evitar que todas las tarjetas compitan al mismo nivel visual.
- Reforzar el mensaje de bienvenida y el proposito de la pantalla.

Criterio de aceptacion:
- El usuario entiende en menos de 5 segundos donde esta y que debe hacer primero.
- Las rutas criticas quedan destacadas por encima de las utilidades secundarias.
- La pantalla no depende de leer toda la rejilla para encontrar el siguiente paso.

Estado QA:
- Verificado en QA autenticado y en productivo. El dashboard ya muestra `Accesos internos`, `Acciones principales` y `Utilidades secundarias`.

### QA-034 - Unificar la shell visual comun del portal

Tipo: UX/UI base
Prioridad: Alta

Descripcion:
- Definir una shell comun para `login`, `dashboard` y modulos.
- Homologar fondo, contenedores, escala tipografica, botones, cards, chips y loaders.
- Mantener identidad propia por modulo sin romper la continuidad del sistema.

Criterio de aceptacion:
- Cambiar de pantalla no se siente como saltar a otro producto.
- Los componentes principales comparten estilos base y estados coherentes.

Estado QA:
- Verificado en QA autenticado y en varias superficies publicadas. La shell comun ya esta aplicada en login, dashboard y modulos clave.

### QA-035 - Diferenciar mejor portal, login y dashboard

Tipo: UX/UI / IA
Prioridad: Alta

Descripcion:
- Clarificar el mensaje de entrada para que el usuario no confunda acceso, autenticacion y tablero.
- Ajustar copy, jerarquia y CTA principal del acceso.
- Hacer explicita la diferencia entre iniciar sesion y entrar al dashboard.

Criterio de aceptacion:
- Un usuario nuevo puede distinguir facilmente el flujo de acceso del flujo de trabajo.
- No queda ambiguedad entre portal, login y dashboard.

Estado QA:
- Verificado en QA: el login ya separa acceso Google y acceso QA, con titulo y proposito claros.

### QA-036 - Simplificar `dashboard/pedidos`

Tipo: UX/UI
Prioridad: Alta

Descripcion:
- Convertir `dashboard/pedidos` en un flujo guiado y menos denso.
- Corregir el copy visible y cualquier texto corrupto.
- Dejar una sola accion principal por bloque y agrupar mejor las secundarias.

Criterio de aceptacion:
- La pantalla se entiende sin escanear demasiados botones.
- El contenido se ve limpio, coherente y con una jerarquia clara.

Estado QA:
- Parcial. La vista humana ya existe y tiene `skip-link`, `main` y regreso, pero sigue mostrando mojibake en el copy visible.

### QA-037 - Replantear `status` como tablero ejecutivo

Tipo: UX/UI / informacion
Prioridad: Media

Descripcion:
- Separar resumen ejecutivo, salud del sistema y detalle tecnico.
- Reducir la necesidad de leer mucho texto para encontrar estado y accion.
- Hacer que `status` funcione como tablero de orientacion rapida.

Criterio de aceptacion:
- La informacion clave se identifica al primer vistazo.
- El detalle tecnico queda disponible sin saturar la vista principal.

Estado QA:
- Requiere revalidacion visual puntual. La experiencia de `status` ya se habia mejorado, pero no se volvio a auditar en esta ultima pasada.

### QA-038 - Homologar `whatsapp-capacitadores` y su QR

Tipo: UX/UI
Prioridad: Media

Descripcion:
- Mantener la landing como entrada clara al modulo.
- Reforzar el retorno visible desde la vista QR hacia la landing o el health.
- Ajustar espaciado, CTA y jerarquia para que se sienta parte del portal.

Criterio de aceptacion:
- El usuario nunca queda atrapado en la pantalla QR.
- La pagina conserva su simplicidad pero con navegacion mas evidente.

Estado QA:
- Verificado en QA autenticado y productivo. La landing y el QR ya tienen retorno, health y acciones claras.

### QA-039 - Redisenar `Planeacion-ley/` con shell de trabajo consistente

Tipo: UX/UI / accesibilidad
Prioridad: Media

Descripcion:
- Mantener el enfoque operativo del planeador, pero unificar su base visual con el resto del portal.
- Revisar encabezado, landmarks, estados vacios y navegacion de retorno.
- Evitar que se perciba como una app aislada.

Criterio de aceptacion:
- La pantalla conserva su utilidad actual y gana continuidad con el portal.
- El usuario identifica rapidamente titulo, accion principal y salida.

Estado QA:
- Parcial. La vista ya es accesible y usa la shell comun, pero aun falta dejar un regreso mas evidente al dashboard.

### QA-040 - Modernizar `facturacion/cotizacion/html`

Tipo: UX/UI / performance percibida
Prioridad: Alta

Descripcion:
- Reducir la friccion de primera carga con mejor estructura visual y feedback de carga.
- Revisar densidad del contenido, jerarquia, estados de espera y copy.
- Alinear el modulo al lenguaje visual del dashboard y del portal.

Criterio de aceptacion:
- La espera inicial se siente guiada y no como pantalla en blanco.
- La superficie conserva su funcionalidad pero mejora mucho la percepcion de velocidad.

Estado QA:
- Parcial. La pagina responde y ya usa la estructura compartida, pero la mejora de performance no fue medida en esta pasada.

### QA-041 - Homologar `SOLVENTACIONES/html`

Tipo: UX/UI / performance percibida
Prioridad: Media

Descripcion:
- Unificar tipografia, espaciado, botoneria y estructura de lectura.
- Dejar mas claro el proposito de la pantalla y su siguiente accion.
- Mantener la mejora de copy y evitar volver a un estado visual degradado.

Criterio de aceptacion:
- La pantalla se ve consistente con el resto del portal.
- El usuario entiende el proposito y la accion principal sin esfuerzo.

Estado QA:
- Parcial. La estructura base ya esta mejorada, pero en QA aun se detecta mojibake en el contenido.

### QA-042 - Separar vista tecnica y operativa en `jobs`

Tipo: UX/UI / arquitectura de informacion
Prioridad: Alta

Descripcion:
- Definir con claridad si `jobs` es superficie tecnica, operativa o ambas.
- Mantener `jobs/view` como entrada humana y dejar `jobs` como contrato tecnico si aplica.
- Reducir ruido visual en la vista operativa y ordenar sus acciones.

Criterio de aceptacion:
- El usuario operativo entra por una vista legible y no por JSON tecnico.
- La separacion entre consumo humano y consumo tecnico es obvia.

Estado QA:
- Verificado en QA autenticado y productivo. `jobs/view` ya funciona como vista humana y `jobs` conserva el contrato tecnico.

### QA-043 - Homologar modulos ligeros del portal

Tipo: UX/UI
Prioridad: Media

Descripcion:
- Aplicar el mismo marco visual a `contabilidad`, `CONSTANCIAS/`, `SUCURSALES-DOCS/`, `FALTANTES-LEY/`, `POLIZA_LEY/` y `SEPARAR-PIPC/`.
- Evitar pantallas vacias o desalineadas con el sistema.
- Reutilizar patrones compartidos de heading, CTA y salida.

Criterio de aceptacion:
- Los modulos ligeros ya no parecen paginas sueltas.
- Todos conservan personalidad, pero dentro del mismo lenguaje visual.

Estado QA:
- Parcial. Varios modulos ya comparten la shell, pero el cierre total de homogeneidad todavia requiere una revision por pantalla.

### QA-044 - Definir tokens visuales del sistema

Tipo: Design system
Prioridad: Alta

Descripcion:
- Formalizar colores, tipografia, radii, sombras, espaciados, tamanos de boton y estados.
- Documentar variantes para primary, secondary, warning, success y neutral.
- Evitar que cada modulo invente su propia interpretacion visual.

Criterio de aceptacion:
- El equipo construye pantallas nuevas sin decidir estilos desde cero cada vez.
- La interfaz mantiene consistencia entre modulos actuales y futuros.

Estado QA:
- Aplicado como base compartida del portal, aunque conviene documentarlo formalmente para evitar que vuelva a fragmentarse.

### QA-045 - Crear guia operativa de navegacion del portal

Tipo: Documentacion / UX
Prioridad: Media

Descripcion:
- Documentar que pantalla sirve como acceso, cual como dashboard, cual como utileria tecnica y cual como vista operativa.
- Incluir el mapa de rutas principales y su proposito.
- Reducir dependencia de conocimiento tribal para soporte y desarrollo.

Criterio de aceptacion:
- Cualquier persona del equipo puede ubicar el punto de entrada correcto para cada caso.
- La documentacion acompana el redisenio y no queda separada del producto.

Estado QA:
- Pendiente como entregable documental separado. El backlog ya lo define, pero todavia no se genero la guia operativa final.

## Orden sugerido de ejecucion

1. `QA-033` Redisenar el dashboard principal.
2. `QA-034` Unificar la shell visual comun del portal.
3. `QA-035` Diferenciar portal, login y dashboard.
4. `QA-036` Simplificar `dashboard/pedidos`.
5. `QA-042` Separar vista tecnica y operativa en `jobs`.
6. `QA-040` Modernizar `facturacion/cotizacion/html`.
7. `QA-038` Homologar `whatsapp-capacitadores` y su QR.
8. `QA-039` Redisenar `Planeacion-ley/`.
9. `QA-041` Homologar `SOLVENTACIONES/html`.
10. `QA-043` Homologar modulos ligeros.
11. `QA-044` Definir tokens visuales.
12. `QA-045` Publicar guia operativa.

## Nota QA

- El dashboard ya es el lugar correcto para empezar porque hoy concentra la primera decision del usuario.
- La mejora real no es agregar mas tarjetas, sino ordenar, unificar y reducir friccion entre superficies.
- Si se quiere, este backlog puede convertirse despues en formato Jira, Linear o GitHub Issues.
