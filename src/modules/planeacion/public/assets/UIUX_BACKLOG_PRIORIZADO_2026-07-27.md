# Backlog UI/UX Priorizado - Desarrollo EG

Fecha: 2026-07-27

Base de revision:
- QA autenticado en `https://apps.desarrolloeg.com/QA`
- Revision visual de `dashboard`, `jobs/view`, `whatsapp-capacitadores`, `Planeacion-ley/`, `SOLVENTACIONES/html` y `facturacion/cotizacion/html`
- Contraste con el codigo local del portal

## Resumen visual

El portal ya mejoro bastante en estructura, accesibilidad y navegacion, pero todavia se percibe fragmentado en lo estetico. La mejor superficie actual es el dashboard autenticado; despues vienen `jobs/view` y `whatsapp-capacitadores`. Las superficies que mas rompen la coherencia visual son `facturacion/cotizacion/html`, `SOLVENTACIONES/html` y algunos cortes de copy/encoding en `dashboard/pedidos`.

## Criterios esteticos

- Una sola familia visual para todo el portal.
- Jerarquia clara: titulo, accion principal, detalle secundario.
- Menos densidad de componentes por pantalla.
- Fondo, tarjetas, botones y estados visuales consistentes.
- Copy limpio, sin textos rotos ni mezcla de estilos.

## Prioridad 0 - Lo que mas impacta la percepcion del portal

### UX-001 - Unificar lenguaje visual del portal

Tipo: Design system
Prioridad: Critica

Problema:
- Cada modulo aun parece venir de una capa visual distinta.
- Hay mezcla de paletas, superficies, sombras y tipografias entre dashboard, jobs, whatsapp, planeacion y facturacion.

Propuesta:
- Definir tokens comunes de color, radius, sombras, tipografia, espaciado y botones.
- Reutilizar una base visual comun para todas las paginas publicas y autenticadas.

Criterio de aceptacion:
- Cambiar de modulo no debe sentirse como cambiar de producto.
- Las tarjetas, CTA y superficies deben verse del mismo sistema.

### UX-002 - Consolidar el dashboard como home principal

Tipo: UX/UI
Prioridad: Critica

Problema:
- El dashboard ya esta mejor, pero sigue cargando demasiadas decisiones al mismo nivel.
- Tabs, barra movil y rejilla de accesos compiten por atencion.

Propuesta:
- Mantener `Acciones principales` y `Utilidades secundarias`, pero reducir ruido inicial.
- Reforzar una lectura editorial: que primero se entienda donde esta el usuario, luego que puede hacer.

Criterio de aceptacion:
- El dashboard debe leerse en un vistazo como home, no como panel saturado.
- La accion principal debe verse antes que el resto.

### UX-003 - Corregir copy roto y mojibake

Tipo: QA visual
Prioridad: Critica

Problema:
- Sigue apareciendo texto corrupto en algunas superficies.
- Eso baja la confianza aunque la funcion este bien.

Propuesta:
- Revisar encoding y contenido servido por `dashboard/pedidos` y `SOLVENTACIONES/html`.
- Validar todos los textos visibles del portal con sesion QA.

Criterio de aceptacion:
- No debe haber `Ã`, `Â` ni caracteres rotos en la interfaz.
- El copy visible debe sentirse limpio y consistente.

## Prioridad 1 - Homogeneidad entre superficies principales

### UX-004 - Redisenar `facturacion/cotizacion/html`

Tipo: UX/UI
Prioridad: Alta

Problema:
- La experiencia sigue viendose mas legacy que el resto del portal.
- Usa una estética aparte con sensacion de herramienta heredada.

Propuesta:
- Llevarla a la misma familia visual que el dashboard.
- Reducir la sensacion de formulario aislado y reforzar jerarquia de edicion, resumen y acciones.

Criterio de aceptacion:
- La pagina debe sentirse nativa del portal.
- Titulo, formulario y acciones deben verse como una sola experiencia.

### UX-005 - Unificar `jobs/view` con el resto del portal

Tipo: UX/UI
Prioridad: Alta

Problema:
- Ya es una buena vista operativa, pero conserva mucho peso visual propio.
- Sigue sintiendose como un panel especial y no como una variacion del mismo sistema.

Propuesta:
- Ajustar composicion, tonos y densidad para acercarla al lenguaje del dashboard.
- Mantener claridad operativa, pero con mejor respiracion visual.

Criterio de aceptacion:
- La pantalla debe verse parte del mismo portal.
- La informacion operativa no debe competir con el contenedor visual.

### UX-006 - Homologar `whatsapp-capacitadores` y QR

Tipo: UX/UI
Prioridad: Alta

Problema:
- Ya esta muy bien resuelto funcionalmente, pero sigue teniendo un lenguaje visual distinto.
- El QR es claro, pero puede verse mas integrado con el portal.

Propuesta:
- Mantener la simplicidad, pero compartir mas claramente estilo de tarjetas, botones y metadatos.

Criterio de aceptacion:
- La landing y el QR deben sentirse hermanados con el dashboard.
- El usuario debe entender rapido donde esta y como volver.

### UX-007 - Revisar `Planeacion-ley/` como shell operacional

Tipo: UX/UI / accesibilidad
Prioridad: Alta

Problema:
- La base visual es buena, pero aun se siente mas tecnica que guiada.
- Falta un cierre visual mas obvio para regreso y continuidad.

Propuesta:
- Reforzar salida, encabezado y jerarquia de entrada.
- Mantener su personalidad, pero con una relacion visual mas cercana al resto del portal.

Criterio de aceptacion:
- Debe verse como parte del portal, no como una app suelta.
- El regreso debe ser evidente y no descubrirse al final.

## Prioridad 2 - Pulido fino de calidad visual

### UX-008 - Limpiar `SOLVENTACIONES/html`

Tipo: UX/UI
Prioridad: Media

Problema:
- Ya tiene la estructura correcta, pero sigue mostrando una mancha visual por mojibake.
- La superficie pierde calidad percibida por detalles de encoding.

Propuesta:
- Corregir el copy rotto y revisar consistencia de pie de pagina, chips y estados.

Criterio de aceptacion:
- Ningun texto visible debe verse corrupto.
- La pantalla debe sentirse pulida, no parcheada.

### UX-009 - Reducir densidad del dashboard admin

Tipo: UX/UI
Prioridad: Media

Problema:
- Aunque ya esta ordenado por familias, sigue habiendo demasiados elementos visibles.
- El usuario todavia tiene que escanear demasiado para decidir.

Propuesta:
- Ocultar o contraer utilidades secundarias por defecto.
- Dejar mas aire en el hero y menos competencia entre tarjetas.

Criterio de aceptacion:
- La primera lectura del dashboard debe ser menos pesada.
- El foco debe ir a la accion principal y no a toda la malla.

### UX-010 - Normalizar la navegacion de retorno

Tipo: UX/UI / accesibilidad
Prioridad: Media

Problema:
- Algunas pantallas tienen retorno claro y otras no tanto.
- El portal aun no tiene un patron visual unico para volver atras.

Propuesta:
- Estandarizar una ubicacion y estilo para `Volver al dashboard` o `Volver al portal`.

Criterio de aceptacion:
- Todas las superficies principales deben tener una salida visible y coherente.
- El retorno no debe depender de adivinar botones.

### UX-011 - Unificar estados vacios y de carga

Tipo: UX/UI
Prioridad: Media

Problema:
- Algunos modulos tienen loaders o estados vacios buenos, otros se sienten mas improvisados.

Propuesta:
- Crear un lenguaje unico para loading, empty state y error state.

Criterio de aceptacion:
- Los estados temporales deben sentirse diseñados, no improvisados.

### UX-012 - Formalizar guia visual interna

Tipo: Documentacion de diseno
Prioridad: Media

Problema:
- La base ya existe, pero no esta documentada como sistema.

Propuesta:
- Dejar una guia corta con colores, botones, chips, cards, jerarquia y patrones de retorno.

Criterio de aceptacion:
- El equipo debe poder replicar el lenguaje visual sin reinventarlo.

## Orden sugerido

1. `UX-001` Unificar lenguaje visual del portal.
2. `UX-002` Consolidar el dashboard como home principal.
3. `UX-003` Corregir copy roto y mojibake.
4. `UX-004` Redisenar `facturacion/cotizacion/html`.
5. `UX-005` Unificar `jobs/view` con el resto del portal.
6. `UX-006` Homologar `whatsapp-capacitadores` y QR.
7. `UX-007` Revisar `Planeacion-ley/` como shell operacional.
8. `UX-008` Limpiar `SOLVENTACIONES/html`.
9. `UX-009` Reducir densidad del dashboard admin.
10. `UX-010` Normalizar la navegacion de retorno.
11. `UX-011` Unificar estados vacios y de carga.
12. `UX-012` Formalizar guia visual interna.

## Nota QA

- El portal ya no esta roto, pero todavia no se siente completamente unificado.
- La mejor forma de subir la calidad percibida ahora es bajar fragmentacion visual y limpiar textos.
- Si el equipo toma este backlog, el primer gran salto deberia sentirse en el dashboard y en facturacion.
