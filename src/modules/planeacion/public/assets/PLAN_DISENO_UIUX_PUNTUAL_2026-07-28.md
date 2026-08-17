# Plan de diseno UI/UX puntual para Desarrollo EG

## Objetivo
Unificar la experiencia visual y de navegacion de toda la appweb para que ninguna pantalla se sienta como una herramienta distinta. La meta es que el usuario perciba un solo portal con una sola logica visual, una sola jerarquia de acciones y una sola forma de moverse entre modulos.

## Base real del proyecto
- Backend principal: `Node.js` + `Express`.
- Vistas server-rendered: `EJS`.
- Estilos compartidos del portal: `CSS` en `/ui/portal-shell.css`.
- Superficies HTML aisladas: vistas y paginas en `src/modules/*`.
- Superficie SPA existente: `Planeacion Ley`, compilada como app `React`.
- Estilos de `Planeacion`: CSS utilitario ya compilado en `index-B1--j7WQ.css` y tema propio en `planeacion-official-theme.css`.
- Iconografia y componentes visuales en `Planeacion`: `lucide-react`, `FullCalendar` y `Leaflet` ya estan presentes en el bundle.

## Lenguajes y tecnologias que deben usarse
### Obligatorio
- `HTML5` semantico.
- `CSS3` con variables, estados `:focus`, `:hover`, `:disabled` y media queries.
- `JavaScript` ES Modules para interaccion ligera.
- `EJS` para vistas server-rendered.
- `JSON` para datos de apoyo y respuestas del backend.

### Ya aceptado por la arquitectura actual
- `React` solo donde la app ya existe como SPA, especialmente `Planeacion`.
- CSS utilitario compilado solo dentro de `Planeacion`, sin mezclarlo como patron visual del resto del portal.
- Integracion con fuentes de datos existentes como `AppSheet`, `Google Drive` y servicios internos ya creados.

### Prohibiciones de diseno tecnico
- No introducir un segundo framework visual para las paginas server-rendered.
- No convertir los modulos del portal en SPA si hoy ya funcionan con vistas EJS.
- No usar componentes distintos para la misma accion segun el modulo.
- No duplicar la logica de estilos en cada vista si puede vivir en el shell compartido.

## Sistema visual unificado
### Tipografia
- Titulos principales: `Cinzel`.
- Interfaz, formularios y microcopy: `Montserrat`.
- Texto corrido y lectura general: `Inter`.

### Color
- Base de marca: azul marino, rojo corporativo y neutros claros.
- Fondo: gradientes suaves y capas transluidas, nunca blanco plano sin profundidad.
- Accion primaria: un solo color dominante por pantalla.
- Estados:
  - Exito: verde sobrio.
  - Advertencia: ambbar/dorado.
  - Error: rojo consistente.
  - Informativo: azul.

### Estructura
- Una sola cabecera funcional por modulo.
- Un solo bloque hero o encabezado por pantalla.
- Una sola zona de contenido principal.
- Una sola zona de acciones principales.
- Un solo pie o zona de regreso cuando aplique.

## Controles que deben normalizarse
### Navegacion
- `a` para ir a otra ruta.
- Boton de volver al dashboard en todas las vistas de trabajo.
- Breadcrumb cuando el modulo tenga mas de un nivel.
- `skip-link` visible al enfoque para accesibilidad.
- `main` con `id` unico por pagina.

### Acciones
- `button` para ejecutar cambios.
- Boton primario solo para la accion principal de la vista.
- Botones secundarios para acciones de apoyo.
- Boton de regreso siempre visible si el usuario sale de una subvista.

### Disclosures
- `details` y `summary` para secciones colapsables.
- Acordeon para bloques largos de configuracion, catalogos o reportes.
- No usar `details` para accion destructiva ni para formularios completos.

### Formularios
- `label` siempre visible.
- `input`, `select`, `textarea`, `checkbox`, `radio`, `date`, `time` segun necesidad.
- Ayuda de campo debajo del control.
- Estado de error en linea, no solo por alerta.
- Controles tactiles con altura minima de 44px.

### Datos
- `table` para listas comparables.
- `cards` para resumenes y colecciones visuales.
- `chips` o `badges` para estados, tipos y prioridades.
- `metrics` para cifras rapidas.

### Feedback
- Loader o skeleton mientras carga informacion.
- Empty state cuando no haya registros.
- Toast o alerta inline para exito y error.
- Confirmacion explicita para acciones delicadas.

## Reglas para que no parezca que son herramientas distintas
1. Todas las pantallas del portal deben compartir la misma base de shell.
2. Las diferencias entre modulos deben ser de contenido, no de lenguaje visual.
3. El header debe conservar la misma logica: titulo, contexto, accion principal y regreso.
4. Las tarjetas deben compartir radio, sombra, borde y espaciado.
5. Los botones deben compartir altura, peso tipografico y jerarquia de color.
6. Los formularios deben compartir la misma distancia entre etiqueta, ayuda y control.
7. Los estados vacios y los errores deben verse como parte del mismo sistema, no como pantallas improvisadas.
8. Los modales, paneles laterales y ventanas emergentes deben usar la misma sombra, borde y radio.
9. Los titulos de modulo deben mantener la misma escala tipografica.
10. Ningun modulo debe introducir colores nuevos sin justificacion de marca o estado.

## Plan de diseno por capas
### Capa 1: shell global
- Mantener y reforzar `portal-shell.css` como capa visual comun.
- Aplicar la misma familia de clases a todas las vistas server-rendered.
- Establecer `body.portal-shell` como requisito en toda pantalla que viva dentro del portal.
- Estandarizar `skip-link`, `page`, `shell`, `hero`, `panel`, `card`, `sheet` y `actions`.

### Capa 2: modulo
- Cada modulo puede tener un acento visual propio, pero solo dentro de la misma paleta base.
- Cada modulo puede cambiar el contenido, no la estructura de navegacion.
- Cada modulo debe incluir:
  - titulo claro,
  - descripcion de contexto,
  - accion principal,
  - regreso visible,
  - zona principal semantica.

### Capa 3: vista especifica
- Los formularios grandes deben dividirse en bloques.
- Los reportes largos deben separarse por subtitulos y acordeones.
- Las tablas grandes deben tener encabezado claro y jerarquia de filas.
- Las vistas tipo documento deben conservar aire editorial y lectura rapida.

## Plan tecnico por superficie
### Dashboard
- Debe ser la referencia visual del portal.
- Debe mostrar jerarquia entre accesos primarios y secundarios.
- Debe usar tarjetas homogeneas, agrupacion por familia de funciones y subtitulos claros.
- Debe conservar una ruta obvia hacia cada modulo sin parecer un menu tecnico.

### Jobs
- Debe mantener la vista tipo operacion diaria.
- Debe priorizar lectura rapida, estado y accion inmediata.
- Debe usar tarjetas, resumenes y detalles colapsables para no saturar.

### WhatsApp Capacitadores
- Debe parecer una herramienta de operacion, no una pagina suelta.
- Debe conservar una entrada clara al flujo principal y un retorno visible.
- Debe usar estados, pasos y feedback tecnico muy legible.

### Planeacion Ley
- Debe respetar su base `React`, pero adoptar la misma atmosfera de portal.
- Debe conservar el sistema de calendario, filtros y mapas, pero con la misma firma visual.
- Debe usar el tema oficial como capa superior y no romper la experiencia de escritorio ni la de impresion.

### Solventaciones
- Debe comportarse como reporte operativo con lectura editorial.
- Debe diferenciar secciones, evidencia, resumen y acciones.
- Debe mantener semantica fuerte para exportacion e impresion.

### Facturacion / Cotizacion
- Debe dejar de sentirse como un documento tecnico aislado.
- Debe unificar el render de cotizacion normal y cotizacion ley bajo la misma identidad visual.
- Debe mostrar titulo, cliente, centro, totales, desglose y firma como partes de una misma narrativa visual.
- Debe mantener contraste suficiente para lectura de tablas y valores economicos.

### Pedidos y pendientes
- Deben usar el mismo patron de hero, estado y tarjetas que el resto del portal.
- Deben evitar columnas, bloques o badges inventados solo para esa vista.

## Criterios de aceptacion
- El usuario puede moverse entre modulos sin sentir que cambio de producto.
- El dashboard, jobs, whatsapp, planeacion, solventaciones y facturacion comparten lenguaje visual.
- Los titulos, botones, cards, forms y tablas se ven parte de un mismo sistema.
- La navegacion primaria y el retorno al dashboard son obvios en todas las pantallas.
- Las pantallas cargan bien en desktop y mobile.
- Los componentes tienen estados de foco visibles y accesibles.
- No hay mojibake, textos rotos ni copy tecnico inconsistente.
- No hay pantallas que parezcan prototipos distintos dentro del mismo portal.

## Orden de implementacion recomendado
1. Cerrar la unificacion del shell en todas las vistas que faltan.
2. Normalizar tipografia, espaciado, sombras y radios en todo el portal.
3. Corregir copy, encoding y microcopy en cada modulo.
4. Ajustar controles y formularios para que compartan el mismo patron.
5. Revisar estados vacios, error y carga.
6. Revalidar mobile, tablet, desktop e impresion.
7. Cerrar con una pasada de QA visual final sobre dashboard, jobs y facturacion.

## Nota de QA actual
- La ruta de cotizacion especifica ya responde correctamente y el problema ya no apunta a caida de servicio.
- La prioridad ahora es de cohesion visual, consistencia de controles y limpieza de contenido.
