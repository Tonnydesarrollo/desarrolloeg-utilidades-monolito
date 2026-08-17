# Guia visual del portal

Referencia corta para mantener una experiencia consistente en el monolito.

## Principios

- Usar la `portal-shell` compartida para todas las pantallas operativas nuevas.
- Priorizar una sola acción principal por tarjeta o bloque.
- Agrupar el contenido secundario dentro de `details`, acordeones o secciones plegables.
- Evitar copys técnicos en la navegación primaria; dejar los detalles dentro de paneles o ayuda contextual.

## Patrones recomendados

- `panel`: bloques principales de lectura.
- `card`: tarjetas de contenido o estado.
- `button primary`: acción principal de la vista.
- `button secondary`: acciones de apoyo o retorno.
- `pill` y `chip`: estado, contexto o metadatos cortos.
- `skip-link`: accesibilidad obligatoria en vistas largas.

## Jerarquía

- Encabezado con contexto de la pantalla.
- Resumen o métricas solo si ayudan a decidir la siguiente acción.
- Lista o grid con el contenido operativo.
- Detalle técnico al final o dentro de un bloque plegable.

## Retorno

- El retorno primario debe ser siempre visible.
- Si la pantalla pertenece a una ruta operativa, el botón de volver debe apuntar al dashboard o al portal padre.
- No duplicar demasiados enlaces de salida en la franja superior.

## Texto

- Mantener acentos correctos y evitar mojibake.
- Preferir títulos cortos y descripciones orientadas a la tarea.
- Usar lenguaje humano en la vista, y reservar el lenguaje técnico para JSON, logs o bloques plegables.
