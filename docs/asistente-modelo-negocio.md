# Modelo de negocio para el asistente

## Identidad, roles y permisos

Cada mensaje de WhatsApp se vincula con un empleado por su numero autorizado. El perfil resuelto por el monolito incluye puesto, rol, acciones permitidas y alcance. `all` permite consultar todos los registros del modulo; `own` limita la consulta a registros asignados al empleado. El asistente nunca debe ampliar ese alcance ni usar datos de otro modulo para evadirlo.

Las acciones son consultar, crear, editar y eliminar. Poder consultar una entidad no implica poder modificarla. Toda operacion que cambie datos requiere una herramienta especifica, permiso para esa accion y confirmacion del usuario. Sin resultado exitoso de la herramienta, la operacion no se considera realizada.

## Entidades y relaciones

Una empresa es un cliente y agrupa muchas sucursales. Una sucursal es una tienda o centro de trabajo y se identifica ante el usuario con su numero de tienda y nombre, no con UUID. La sucursal relaciona ubicacion, trabajos contratados, planeacion, capacitaciones y su carpeta de documentos.

Una capacitacion tiene fecha, horarios, una sede, varias sucursales participantes y uno o varios capacitadores. Programada significa que su fecha aun no ocurre; finalizada significa que la fecha ya paso. `DIPLOMAS` indica el avance de constancias, pero no describe el tema impartido. Si el tema o tipo de curso no esta registrado, debe indicarse como dato ausente.

PIPC representa el avance documental de un Programa Interno de Proteccion Civil. Sistema PC representa la etapa de una solicitud ante Proteccion Civil Estatal. Son estados distintos y deben informarse por separado. Los trabajos municipales se relacionan con planes de contingencia y tampoco deben mezclarse con PIPC estatal.

Una cotizacion pertenece a una empresa y puede incluir centros de trabajo, proveedor y partidas. Cada partida relaciona un concepto del catalogo, cantidad, precio, IVA, subtotal y total.

Los documentos se almacenan en Google Drive y se localizan dentro de la carpeta asociada a una sucursal. Una coincidencia de nombre de archivo no demuestra un estado operativo; el contenido de la base y los documentos son fuentes complementarias.

## Reglas de respuesta

Las cantidades, estados, listas y atributos actuales siempre deben proceder de herramientas o contexto verificado. Se usan etiquetas legibles y fechas en texto. Si una consulta no encuentra coincidencias, se informa cero y se mencionan los filtros aplicados. Si el usuario no tiene permiso, se indica la restriccion sin revelar los datos. Si el campo solicitado no existe, se explica cual dato falta sin inventarlo.
