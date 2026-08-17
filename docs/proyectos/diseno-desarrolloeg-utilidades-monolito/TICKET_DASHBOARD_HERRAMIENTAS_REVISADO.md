# Ticket tecnico: Reordenar dashboard y herramientas

**Objetivo**
Revisar y reorganizar la experiencia del dashboard y de las herramientas operativas para que el usuario entienda primero donde esta, que puede hacer y que es secundario, sin perder la identidad institucional de Desarrollo EG.

**Contexto**
La revision actual muestra que el portal ya tiene una base visual consistente, pero el dashboard y las herramientas siguen compitiendo entre si en jerarquia y densidad visual. El resultado es una experiencia util, pero demasiado cargada para una entrada principal.

**Problema**
- El dashboard principal mezcla varias intenciones al mismo nivel visual.
- La vista de herramientas y estado tecnico se percibe como un producto aparte.
- Los modulos operativos muestran demasiada informacion en la primera lectura.
- La navegacion por pestanas, chips y cards mantiene acceso rapido, pero no prioriza lo esencial.

**Hallazgos de la revision**
- El dashboard principal agrupa `Calendario`, `Gestion`, `Pedidos`, `Faltantes`, `Diplomas faltantes` y `Faltantes Ley` en la misma superficie.
- La seccion de estado de servicios usa una personalidad visual distinta y mas tecnica.
- El modulo de jobs es correcto funcionalmente, pero la primera vista sigue siendo densa.
- La base de estilos del portal es buena y no necesita una ruptura total; el problema es de arquitectura de informacion.

**Alcance**
- Reordenar la jerarquia visual del dashboard principal.
- Definir una separacion clara entre:
  - entrada principal del usuario,
  - herramientas operativas,
  - paneles tecnicos o de soporte.
- Reducir carga visual en tarjetas, tabs y bloques secundarios.
- Mantener colores institucionales y referencia al logo.
- Conservar funcionalidad existente.

**Fuera de alcance**
- Login y autenticacion.
- Cambios de backend que no afecten la experiencia visual o la priorizacion de la interfaz.
- Rediseno completo de marca o logotipo.

**Reglas de diseno**
- Respetar la identidad visual institucional de Desarrollo EG.
- No introducir textos de trabajo, notas internas o etiquetas de boceto en la interfaz final.
- No convertir el dashboard en un simple lanzador de modulos.
- No perder la claridad de acceso rapido a las acciones mas usadas.
- La estetica puede cambiar en favor de una mejor jerarquia, siempre que conserve la marca.

**Propuesta de direccion UX**
- Dar mas peso visual a una sola accion o bloque principal por vista.
- Agrupar herramientas secundarias en una zona de soporte claramente separada.
- Mantener los accesos operativos, pero con menor protagonismo visual.
- Usar respiro, subtitulos cortos y menos ruido tipografico.
- Hacer que la experiencia lea como un sistema unico, no como varias pantallas pegadas.

**Archivos a revisar**
- `src/modules/home/home.router.js`
- `src/modules/dashboard/dashboard.service.js`
- `src/modules/jobs/jobs.router.js`
- `src/public/ui/portal-shell.css`

**Criterios de aceptacion**
- El dashboard debe tener una jerarquia visual mas clara en la primera lectura.
- Las herramientas tecnicas deben sentirse separadas de la operacion diaria.
- La experiencia debe seguir siendo rapida para usuarios frecuentes.
- No deben aparecer notas internas ni copy de borrador.
- El sistema debe conservar la identidad institucional y el lenguaje visual del portal.
- La version nueva debe ser usable en desktop y mobile sin perder claridad.

**Notas para desarrollo**
- Si una seccion no aporta decision rapida, debe bajar de jerarquia.
- Si una pantalla mezcla operacion y diagnostico, debe dividirse o segmentarse mejor.
- Si el contenido crece, la solucion debe apoyarse mas en estructura que en adornos.
