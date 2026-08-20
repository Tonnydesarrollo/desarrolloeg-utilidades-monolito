# Guia visual del portal

Referencia corta para mantener una experiencia consistente en el monolito.

## Principios

- Usar la `portal-shell` compartida para todas las pantallas operativas nuevas.
- Priorizar una sola accion principal por tarjeta o bloque.
- Agrupar el contenido secundario dentro de `details`, acordeones o secciones plegables.
- Evitar copys tecnicos en la navegacion primaria; dejar los detalles dentro de paneles o ayuda contextual.

## Regla estricta de copy

- No mostrar textos de trabajo, notas internas, borradores o explicaciones de arquitectura en la interfaz final.
- No usar cuadros tipo dialogo, callout, aviso interno o bloque de documentacion dentro del front.
- Si algo es tecnico, va en documentacion, logs, JSON o paneles plegables de diagnostico.
- La portada y las pantallas operativas solo deben mostrar titulo, contexto, accion y retorno.

## Patrones recomendados

- `panel`: bloques principales de lectura.
- `card`: tarjetas de contenido o estado.
- `button primary`: accion principal de la vista.
- `button secondary`: acciones de apoyo o retorno.
- `pill` y `chip`: estado, contexto o metadatos cortos.
- `skip-link`: accesibilidad obligatoria en vistas largas.

## Jerarquia

- Encabezado con contexto de la pantalla.
- Resumen o metricas solo si ayudan a decidir la siguiente accion.
- Lista o grid con el contenido operativo.
- Detalle tecnico al final o dentro de un bloque plegable.

## Retorno

- El retorno primario debe ser siempre visible.
- Si la pantalla pertenece a una ruta operativa, el boton de volver debe apuntar al dashboard o al portal padre.
- No duplicar demasiados enlaces de salida en la franja superior.

## Texto

- Mantener acentos correctos y evitar mojibake.
- Preferir titulos cortos y descripciones orientadas a la tarea.
- Usar lenguaje humano en la vista, y reservar el lenguaje tecnico para JSON, logs o bloques plegables.
