# Reporte funcional del monolito para rediseño de interfaz

## 1. Objetivo y alcance

Este documento describe la interfaz de negocio del monolito Desarrollo EG para que diseño pueda reorganizarla por rol sin inventar campos, catálogos ni relaciones. El alcance es exclusivamente la experiencia de las personas que consultan, capturan, actualizan, generan o envían información del negocio.

La autenticación se realiza con cuenta de Google autorizada. No se debe diseñar un formulario propio de usuario y contraseña.

## 2. Qué es el monolito

El monolito es el portal operativo de Desarrollo EG. Reúne en una misma aplicación:

- Agenda, capacitaciones, notas y constancias.
- Consulta de empresas, sucursales, trabajos y documentación.
- Pedidos de Casa Ley, liberaciones y envío de archivos.
- Cotizaciones y conceptos por centro de trabajo.
- Planeación territorial y mensual de capacitaciones.
- Seguimiento de Protección Civil y solventaciones.
- Generación de cartas, cédulas, pólizas y reportes.
- Captura de tickets para contabilidad.

La interfaz consume datos de la base local sincronizada y, en ciertas operaciones, conserva identificadores de AppSheet. Aunque el usuario debe ver etiquetas legibles, la aplicación debe enviar los IDs reales.

## 3. Modelo de información que condiciona la UI

### 3.1 Jerarquía territorial y comercial

La relación principal es:

`Empresa -> Estado -> Municipio -> Sucursal o centro de trabajo`

Reglas de diseño:

- Empresa, estado, municipio y sucursal son selecciones de catálogo, no texto libre, salvo el flujo explícito de cotización para cliente no registrado.
- Al seleccionar sucursales para una operación, el sistema debe conservar automáticamente los IDs de sus estados y municipios.
- Los filtros pueden reducir resultados, pero no deben eliminar las relaciones requeridas al guardar.
- La UI muestra nombres, números de tienda y etiquetas; los IDs son internos y no deben pedirse al usuario.
- Las sucursales inactivas no deben ofrecerse en operaciones nuevas.

### 3.2 Relaciones operativas

- Una capacitación tiene fecha, horario, sede, sucursales, capacitadores, estatus, notas y estado de diplomas.
- Una constancia nace de una capacitación y sus participantes; los archivos generados se vinculan a la sucursal y a la capacitación.
- Un trabajo corresponde a una sucursal y año, y puede tener estatus, documentación requerida, capacitación y carpeta de Drive.
- Un pedido corresponde a una sucursal y tipo de trabajo; puede tener archivos elegibles para envío y un estado de envío.
- Una cotización pertenece a una empresa registrada o a un destinatario externo, contiene centros de trabajo y conceptos por centro.
- Una solventación corresponde a una solicitud o visita de una sucursal y agrupa incidencias y evidencias.

## 4. Roles y permisos vigentes

La autorización debe resolverse en servidor. Ocultar un botón no sustituye la validación de permisos.

| Perfil derivado del puesto | Alcance | Acciones |
|---|---|---|
| Director general | Todos los registros | Ver, crear, editar y eliminar |
| Mejora continua | Todos los registros | Ver, crear, editar y eliminar |
| Gerente general | Todos los registros | Ver, crear y editar; no eliminar |
| Capacitador o empleado con `CAPACITA` activo | Sus capacitaciones, constancias y agenda; lectura global de sucursales | Ver, crear y editar dentro de su alcance; puede gestionar sus notas |
| Sin acceso | Ninguno | No debe entrar al portal |

Particularidades del capacitador:

- Calendario: consulta, alta y edición en alcance propio.
- Capacitaciones: consulta y edición en alcance propio.
- Constancias faltantes: sólo las propias.
- Creación de constancias: por capacitador o capacitación dentro de su alcance.
- Información de sucursales: lectura general.
- Notas: lectura global cuando corresponde y mantenimiento de las propias.

## 5. Arquitectura de información recomendada

### 5.1 Navegación de Director general y Mejora continua

1. **Inicio**: resumen accionable, agenda cercana, pendientes y accesos recientes.
2. **Operación**: capacitaciones, constancias, trabajos y planeación.
3. **Clientes y sucursales**: empresas, sucursales, documentos y reportes.
4. **Protección Civil**: faltantes, seguimiento estatal, solventaciones y pólizas.
5. **Pedidos y facturación**: pedidos, envíos, cotizaciones y contabilidad.

### 5.2 Navegación de Gerente general

Debe conservar la misma estructura de consulta y operación, pero sin acciones de eliminación. Los controles no permitidos deben desaparecer, no mostrarse deshabilitados sin explicación.

### 5.3 Navegación de Capacitador

1. **Mi día**: próxima capacitación, agenda y notas.
2. **Mis capacitaciones**: programadas, finalizadas y detalle.
3. **Mis constancias**: pendientes y generación.
4. **Sucursales**: consulta de datos y documentación autorizada.

No debe recibir el tablero administrativo completo ni accesos a tareas ajenas a su trabajo.

## 6. Patrones comunes de interfaz

- Usar una búsqueda global sólo para navegar; cada módulo conserva sus filtros específicos.
- Mantener filtros en una barra estable y resultados en tabla o lista. No convertir cada filtro en una tarjeta.
- Mostrar número de tienda más nombre de sucursal. Nunca mostrar únicamente el ID.
- Presentar fechas en texto al leerlas y usar control de fecha al capturarlas.
- Usar selectores dependientes para Empresa, Estado, Municipio y Sucursal.
- Separar claramente `Filtrar`, `Seleccionar` y `Guardar`. Filtrar resultados no equivale a seleccionarlos.
- Deshabilitar una acción de envío o generación mientras esté en curso y esperar confirmación o fallo.
- Los estados vacío, cargando, error, sin permiso y éxito deben formar parte del diseño.
- Confirmar acciones destructivas y reenvíos. Las actualizaciones normales no necesitan diálogos innecesarios.

## 7. Diccionario de entradas del frontend

La columna **Uso** distingue datos persistentes de filtros o preferencias visuales.

### 7.1 Acceso

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Iniciar con Google | Botón OAuth | Acción | La cuenta debe corresponder a un empleado autorizado |

No existen campos propios de correo, contraseña, puesto o rol. Esos datos se resuelven desde la cuenta y el registro del empleado.

### 7.2 Dashboard, calendario y capacitaciones

| Entrada | Control | Uso | Regla u opciones |
|---|---|---|---|
| Estatus de capacitación | Select de filtro | Filtro | Todos, programadas o finalizadas |
| Capacitador | Select de empleados | Filtro | Catálogo autorizado; para capacitador queda limitado a sí mismo |
| Diplomas | Select de filtro | Filtro | Todos, con diplomas o sin diplomas |
| Estatus | Control segmentado | Persistente | `PROGRAMADA` o `FINALIZADA` |
| Diplomas entregados | Control binario | Persistente | `Y` o `N` |
| Nueva entrada de notas | Textarea, obligatorio | Persistente | Texto del hilo de la capacitación |

Datos mostrados, no editables en este flujo: fecha, hora inicial, hora final, sede, sucursales, capacitadores y archivos o enlaces disponibles.

### 7.3 Nota de calendario

| Entrada | Control | Uso | Regla u opciones |
|---|---|---|---|
| Fecha | Fecha, obligatoria | Persistente | Formato enviado por control de fecha |
| Icono | Select | Persistente | Opciones definidas por el sistema |
| Título | Texto, opcional | Persistente | Ejemplo actual: Recordatorio interno |
| Notas | Textarea, opcional | Persistente | Detalle de la nota |
| Empleados | Lista de checkboxes | Persistente | IDs de empleados autorizados o `TODOS` |

`rowId` y la ruta de regreso son valores internos. No deben presentarse como campos.

### 7.4 Constancias

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Capacitador | Select de empleados | Filtro/alcance | Catálogo autorizado por el rol |
| Capacitación | Select | Selección | Sólo capacitaciones visibles para el usuario |
| Participantes | Selección dentro de la capacitación | Persistente en documento | Proceden del contexto de la capacitación; no inventar registros ajenos |
| Plantilla blanca | Acción | Generación | Alternativa explícita sin capacitación |
| Guardar PDF en Drive | Acción | Persistente | Destino resuelto por sucursal y capacitación |
| Guardar CSV de participantes | Acción | Persistente | Destino resuelto por sucursal y capacitación |
| Diplomas entregados | Control binario | Persistente | `Y` o `N` |

El nombre de archivo, sucursal, carpeta de Drive y capacitación se derivan del contexto. No deben capturarse manualmente salvo una función administrativa futura expresamente aprobada.

### 7.5 Trabajos

| Entrada | Control | Uso | Regla u opciones |
|---|---|---|---|
| Año | Select | Filtro | Años disponibles |
| Empresa | Select | Filtro | Catálogo de empresas |
| Estatus | Select | Filtro | Catálogo de estatus del módulo |
| Capacitación | Select | Filtro | Todas o estado disponible |
| Buscar | Búsqueda | Filtro | Sucursal, empresa o municipio |
| Estatus del trabajo | Select por registro | Persistente | Sólo valores del catálogo de estatus |
| Documentación | Checkboxes por registro | Persistente | Catálogo de documentos requeridos |

Fecha de creación, datos de capacitación, capacitadores, documentos pendientes y enlace de Drive son informativos.

### 7.6 Faltantes de Casa Ley

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Estado | Select | Filtro | Estados disponibles |
| Municipio | Select dependiente | Filtro | Municipios del estado o resultados actuales |
| Buscar | Búsqueda | Filtro | Sucursal, municipio o pendiente |
| Grupos de faltantes | Checkboxes | Filtro | Categorías calculadas por el sistema |
| Tamaño de página | Select | Preferencia | No altera datos |

Es una vista de consulta. Los contadores y categorías son calculados; no son entradas editables.

### 7.7 Pedidos y envío

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Buscar pedido | Búsqueda | Filtro | Pedido, sucursal, descripción y, en administración, municipio, estado o UUID |
| Facturador | Select | Filtro/configuración operativa | Catálogo de facturadores |
| Año | Número o select | Filtro | Rango actual permitido: 2020 a 2100 |
| Umbral estatal | Número decimal no negativo | Persistente administrativo | Importe de clasificación |
| Umbral municipal | Número decimal no negativo | Persistente administrativo | Importe de clasificación |
| Remitente | Select | Persistente para el envío | Sólo cuentas habilitadas |
| Correo destino | Correo | Persistente para el envío | Debe validar sintaxis de correo |
| Archivos | Checkboxes por pedido | Selección | Sólo se envían los archivos marcados |
| Enviado | Checkbox/estado por pedido | Persistente | Refleja confirmación real de envío |
| Reenviar | Acción con confirmación | Acción | Debe pedir confirmación explícita |

Durante un envío, el botón permanece bloqueado hasta obtener respuesta. Después del éxito debe actualizarse el listado y el pedido debe pasar al estado correspondiente.

### 7.8 Cotizaciones

#### Cliente y firma

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Tipo de cliente | Segmentado | Persistente | Empresa registrada o no registrada |
| Empresa | Select, obligatorio si registrada | Persistente | Catálogo de empresas |
| Sin pedido municipal | Checkbox | Filtro | Reduce sucursales; no se guarda como dato de cotización |
| Sin pedido estatal | Checkbox | Filtro | Reduce sucursales; no se guarda como dato de cotización |
| Cotización dirigida a | Texto, obligatorio si externa | Persistente | Persona o empresa no registrada |
| Fecha | Fecha | Persistente | Fecha de la cotización |
| Quién firma | Select, obligatorio | Persistente | Catálogo de firmantes |

#### Centros de trabajo

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Estados | Multiselect | Filtro y relación derivada | IDs de estados disponibles para la empresa |
| Municipios | Multiselect dependiente | Filtro y relación derivada | IDs de municipios válidos para empresa y estados |
| Buscar centro | Búsqueda | Filtro | Número, nombre o dirección |
| Centros de trabajo | Checkboxes | Persistente | IDs de sucursales activas |
| Centros externos | Textarea | Persistente | Sólo cliente externo; un centro por línea |

Al elegir centros registrados, sus estados y municipios deben incorporarse automáticamente al registro aunque el usuario no los haya usado como filtros.

#### Conceptos por centro

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Buscar concepto | Búsqueda | Filtro | Producto, servicio o código |
| Concepto | Select o checkbox | Persistente | ID del catálogo de conceptos |
| Cantidad | Número entero no negativo | Persistente | Paso 1 |
| Precio | Moneda no negativa | Persistente | Paso 0.01 |
| IVA | Porcentaje | Persistente | 0 a 100; el valor visible típico es 16, no el importe calculado |
| Agregar a todos | Acción | Acción | Replica el concepto en centros seleccionados |

Los conceptos hijos se guardan manualmente por centro. La cotización padre debe conservar las relaciones de empresa, estados, municipios y centros. Los campos internos de IDs no son visibles.

#### Presentación del documento

Estas opciones cambian la salida visual, no la información base:

- Desglosar PIPC.
- Desglosar capacitación de brigadas.
- Mostrar código del catálogo.
- Mostrar descripción del catálogo.
- Mostrar dirección de la sucursal.
- Forma de pago: `Dos pagos` o `Una sola exhibición`.

### 7.9 Planeación de capacitaciones

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Estado | Checkboxes múltiples | Filtro | Valores existentes en sucursales |
| Municipio | Checkboxes dependientes | Filtro | Valores existentes para los estados elegidos |
| Planeación | Select | Filtro | Todas, con mes o sin mes |
| Buscar sucursal | Búsqueda | Filtro | Nombre, título o dirección |
| Mes | Selector de enero a diciembre o Sin asignar | Persistente | Mes de capacitación |
| Tienda | Texto | Persistente administrativo | Obligatorio al crear; normalmente debe venir del catálogo |
| Sucursal | Texto | Persistente administrativo | Obligatorio al crear |
| Dirección | Textarea | Persistente administrativo | Puede sugerirse desde coordenadas |
| Estado | Texto | Persistente administrativo | Dato territorial de la sucursal |
| Municipio | Texto | Persistente administrativo | Dato territorial de la sucursal |
| Latitud | Número | Persistente administrativo | Coordenada válida |
| Longitud | Número | Persistente administrativo | Coordenada válida |
| Importar respaldo | Archivo CSV | Acción administrativa | Formato existente de sucursales |

Vistas disponibles: mapa, calendario de planeación y calendario de vencimientos. El color de estatus es calculado, no capturable.

### 7.10 Seguimiento de Protección Civil y solventaciones

#### Vista operativa

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Año | Select | Filtro | Año disponible |
| Empresa | Select | Filtro | Todas o empresa del catálogo |
| Buscar sucursal | Búsqueda | Filtro | Sucursal, tienda, municipio o solicitud |
| Solicitudes listas | Checkboxes | Selección | Sólo solicitudes calculadas como elegibles |

Etapas informativas existentes: Lista para crear, Creada, En captura, Revisión de campo, Visitada, Autorizada y Firmada.

#### Reporte de solventaciones

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Tienda | Texto con sugerencias | Filtro | Catálogo de tiendas |
| Razón social | Texto con sugerencias | Filtro | Catálogo de razones sociales |
| Municipio | Texto con sugerencias | Filtro | Catálogo de municipios |
| Año | Valor de contexto | Filtro | Se conserva al navegar desde la vista operativa |
| Solicitudes | IDs internos de contexto | Filtro | No deben mostrarse como captura manual |

Los estados de incidencias, evidencias, fotografías y estadísticas son salida del reporte.

### 7.11 Documentos de sucursales

| Entrada | Control | Uso | Regla u opciones |
|---|---|---|---|
| Buscar sucursal | Búsqueda | Filtro | Tienda, sucursal, empresa o municipio |
| Empresa | Select | Filtro | Todas o empresa del catálogo |
| Estado | Select | Filtro | Todos o estado del catálogo |
| Municipio | Select | Filtro | Todos o municipio del catálogo |
| Tipo | Select | Filtro | Todos o tipo de sucursal |
| Sucursales | Multiselect | Persistente para generación | IDs de sucursales |
| Documento | Select | Persistente para generación | Carta Compromiso Municipal; Carta de Entrega Culiacán; Carta de Entrega Navolato; Cédula de Simulacro |
| Quién firma | Select | Persistente para generación | Catálogo de empleados firmantes |

ID, tienda, etiqueta, municipio, estado, tipo y empresa de la sucursal activa son datos informativos. Acciones: previsualizar, abrir HTML, descargar PDF y restaurar datos originales.

### 7.12 Reporte de inspecciones

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Buscar sucursal | Búsqueda | Filtro | Número, ciudad o nombre |
| Periodo | Select | Filtro | Últimos 12 meses o un año disponible |
| Sucursal | Select | Filtro | Sólo sucursales con inspecciones en el periodo |
| Categorías | Chips calculados | Filtro | Categorías presentes en resultados |

Observaciones, imágenes, cifras y periodo son resultados. Las acciones son previsualizar y descargar PDF.

### 7.13 Separar PIPC

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Archivo PIPC | Archivo | Acción | Un PDF (`application/pdf`) |

La salida es una lista de PDFs detectados: análisis de riesgo, acta de unidad interna, croquis, evidencia de capacitación, bitácoras, certificado de fumigación, inventario de bomberos, seguro de daños a terceros y simulacro. Esos nombres son resultados, no checkboxes de captura.

### 7.14 Póliza Ley

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Buscar ubicación | Texto | Filtro | Ubicación o domicilio |
| Página | Número entero | Preferencia | Mínimo 1 |
| Zoom | Número decimal | Preferencia | 0.75 a 3; paso 0.05 |

La póliza encontrada y su vista previa son salida. La descarga no requiere campos adicionales.

### 7.15 Contabilidad

| Entrada | Control | Uso | Regla |
|---|---|---|---|
| Foto desde cámara | Archivo de imagen | Persistente/procesamiento | `image/*`, captura con cámara disponible |
| Elegir imagen | Archivo de imagen | Persistente/procesamiento | `image/*` desde galería o archivo |

Proveedor, RFC, fecha, hora, folio, subtotal, IVA, total, observaciones, nombre y tamaño del archivo y estado de lectura son resultados extraídos; no deben presentarse inicialmente como campos inventados de captura.

## 8. Datos que nunca debe pedir el diseño

- IDs de empresa, estado, municipio, sucursal, empleado, capacitación, solicitud, concepto o cotización.
- Rol, puesto o permisos del usuario.
- URL de Drive cuando ya existe en la sucursal.
- Nombre técnico de tabla, nombre de columna o UUID interno.
- Totales, IVA calculado, contadores o estatus derivados.
- Carpeta destino de constancias y documentos cuando puede resolverse por sucursal.
- Fecha de creación, usuario creador o rutas internas de retorno.

## 9. Reglas de validación transversales

1. Toda opción de catálogo se envía por ID y se muestra por etiqueta.
2. Municipio debe pertenecer al estado; sucursal debe pertenecer al municipio, estado y empresa seleccionados.
3. Una sucursal inactiva puede consultarse históricamente, pero no seleccionarse para una operación nueva.
4. Los importes no admiten negativos; el IVA se captura como porcentaje y se calcula fuera del campo.
5. Una acción que genera, sube o envía archivos debe impedir dobles ejecuciones hasta recibir respuesta.
6. La interfaz debe conservar la selección al cambiar filtros, salvo que el usuario la quite expresamente.
7. Los mensajes de error deben indicar el campo o relación inválida con su etiqueta, nunca sólo el ID.
8. Tras guardar, enviar o cambiar estatus, la vista debe actualizar el registro confirmado por el servidor.

## 10. Entregables esperados del rediseño

- Mapa de navegación separado para perfiles administrativos, gerencia y capacitadores.
- Wireframes responsive de los flujos principales, no una portada promocional.
- Biblioteca de controles para catálogo dependiente, filtros, tablas, selección múltiple, estados y confirmaciones.
- Prototipos de: agenda/capacitación, cotización, pedidos/envío, trabajos, documentos y seguimiento de Protección Civil.
- Especificación de estados vacío, carga, error, éxito, sólo lectura y sin permiso.
- Matriz de cada control contra los campos de este documento. Cualquier campo adicional debe validarse con producto y backend antes de diseñarse.

## 11. Prioridad sugerida

1. Unificar navegación y autorización por rol.
2. Rediseñar dashboard y flujo móvil del capacitador.
3. Consolidar Empresa, Estado, Municipio y Sucursal en un selector dependiente reutilizable.
4. Rediseñar cotizaciones y pedidos por su cantidad de reglas y riesgo operativo.
5. Normalizar generación y consulta documental.
6. Aplicar los mismos patrones al resto de consultas y reportes.

Este reporte describe el contrato funcional actual. El rediseño puede cambiar jerarquía visual, distribución y navegación, pero no debe cambiar nombres, tipos, relaciones, obligatoriedad ni procedencia de los datos sin una modificación coordinada del backend.
