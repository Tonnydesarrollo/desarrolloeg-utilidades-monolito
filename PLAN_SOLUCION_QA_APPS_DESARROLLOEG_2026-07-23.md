# Plan tecnico de solucion - QA apps.desarrolloeg.com

Fecha: 2026-07-23

Este documento traduce el reporte de QA en un plan tecnico de ejecucion por tareas concretas.
El objetivo es cerrar las incidencias visibles, reducir riesgo operativo y dejar claramente definida la arquitectura de soporte para los modulos involucrados.

## Contexto

Hallazgos principales del QA:

1. La ruta publica `/whatsapp-capacitadores` responde `404`.
2. Existen fallos activos en jobs de fondo, incluyendo un login bloqueado en ClubFactura y un timeout en `pedidos-native-sync`.
3. Hay un posible desfase de mes en la migracion CSV de Planeacion.
4. Los CSV locales parecen ser soporte de migracion o legado, no la fuente de verdad del runtime.

## Principios de solucion

- No cambiar el contrato de negocio sin validacion explicita.
- Priorizar correcciones que eliminen rutas rotas y fallos operativos visibles.
- Mantener AppSheet como fuente de verdad de Planeacion hasta que exista una decision formal de migracion.
- Reducir ambiguedad documental: cada artefacto debe quedar clasificado como activo, legado o migracion.
- Cada cambio funcional debe ir acompanado de prueba y criterio de aceptacion.

## Alcance tecnico

Incluye:

- Routing y experiencia de entrada de WhatsApp Capacitadores.
- Observabilidad, resiliencia y trazabilidad de jobs.
- Contrato de mes para migracion de Planeacion.
- Documentacion de fuente de verdad y retiro controlado de CSV locales.

No incluye:

- Migracion completa de Planeacion a otra base de datos.
- Redisenio visual completo del portal.
- Reescritura de la arquitectura del monolito.

## Epica 1: Corregir la entrada publica de WhatsApp Capacitadores

### Objetivo

Eliminar la ruta muerta desde el portal y ofrecer una entrada util al modulo.

### Estado actual observado

- El modulo esta montado en `app.js` bajo `/whatsapp-capacitadores`.
- El router actual expone `/health`, `/qr` y `/qr.png`.
- La ruta base `/whatsapp-capacitadores` no tiene handler y responde `404`.

### Tareas

#### 1.1 Definir comportamiento de la ruta base

Decision tecnica recomendada:

- Opcion preferida: crear una landing en `/whatsapp-capacitadores`.
- Opcion minima aceptable: redirigir `/whatsapp-capacitadores` a `/whatsapp-capacitadores/qr`.

Recomendacion de arquitectura:

- Implementar landing, no solo redirect, porque permite mostrar estado, acceso al QR y contexto operativo.

#### 1.2 Implementar handler base

Contenido minimo sugerido:

- Estado actual del bot.
- Enlace a `/whatsapp-capacitadores/qr`.
- Enlace a `/whatsapp-capacitadores/health`.
- Indicador visual de conectado / no conectado.

#### 1.3 Ajustar la tarjeta del portal si aplica

- Verificar que el enlace desde el portal apunte a la experiencia correcta.
- Mantener el texto descriptivo alineado con la nueva landing.

#### 1.4 Agregar prueba de ruta

- Prueba de integracion para asegurar que `/whatsapp-capacitadores` responde `200` o redireccion valida.
- Prueba de regresion para confirmar que `/whatsapp-capacitadores/qr` y `/whatsapp-capacitadores/health` siguen activos.

### Criterios de aceptacion

- `/whatsapp-capacitadores` no responde `404`.
- El usuario llega a una experiencia util sin pasos muertos.
- El modulo conserva acceso directo al QR y al health.

### Riesgos

- Si se implementa solo redirect, la experiencia seguira siendo pobre para soporte.
- Si la landing depende demasiado del estado del bot, puede mostrar errores sin contexto suficiente.

---

## Epica 2: Estabilizar jobs de fondo y su observabilidad

### Objetivo

Hacer visibles, diagnosticables y mas resistentes los jobs criticos.

### Estado actual observado

- `jobsRouter` expone el listado y ejecucion manual de jobs.
- El reporte QA detecto fallos activos en health relacionados con jobs criticos.
- Hay al menos dos incidencias mencionadas:
  - login bloqueado en ClubFactura
  - timeout en `pedidos-native-sync`

### Tareas

#### 2.1 Clasificar jobs criticos

Crear inventario con:

- Nombre del job
- Proposito
- Dependencias externas
- Frecuencia
- Tiempo esperado de ejecucion
- Riesgo operativo
- Dueño funcional o tecnico

#### 2.2 Separar salud de plataforma y salud operativa

Recomendacion:

- Mantener `/health` para salud general del proceso y coordinacion.
- Exponer un detalle especifico de jobs, por ejemplo:
  - ultimo estado
  - ultimo error
  - duracion
  - ultimo intento
  - retries

#### 2.3 Normalizar errores de jobs

Definir categorias:

- `retryable`
- `non_retryable`
- `auth_required`
- `timeout`
- `dependency_unavailable`

Esto permite tomar decisiones de reintento y alertamiento de forma consistente.

#### 2.4 Implementar resiliencia para Jobs de alto impacto

Para `ClubFactura`:

- Revisar la caducidad o bloqueo del login.
- Separar autenticacion, descarga y procesamiento.
- Registrar causa exacta del bloqueo.

Para `pedidos-native-sync`:

- Revisar timeout actual.
- Agregar backoff controlado.
- Aislar fallas por lote o por pedido.

#### 2.5 Agregar trazabilidad estructurada

Cada ejecucion debe guardar:

- job id
- timestamp inicio/fin
- duracion
- resultado
- error normalizado
- nodo ejecutor, si aplica

#### 2.6 Agregar pruebas

- Prueba de job exitoso.
- Prueba de job con timeout.
- Prueba de job con fallo de autenticacion.
- Prueba de que el estado de jobs aparece en el endpoint correspondiente.

### Criterios de aceptacion

- Los fallos de jobs criticos se ven de forma clara y separada.
- Un timeout o login bloqueado no rompe toda la operacion sin contexto.
- Los jobs críticos cuentan con historial minimo de ejecucion y error.

### Riesgos

- Si se deja todo en logs sin estructura, el diagnostico seguira siendo lento.
- Si los retries se configuran sin clasificacion, pueden amplificar fallos.

---

## Epica 3: Validar y fijar el contrato de mes en Planeacion

### Objetivo

Eliminar la ambiguedad sobre si el mes de origen es 0-based, 1-based o ya normalizado.

### Estado actual observado

- `normalizePlaneacionMonthFromCsv()` suma `+1`.
- `migrate-casaley-csv` usa ese valor al guardar `MES PLANEACION`.
- El CSV local contiene `assigned_month`, lo que sugiere que podria ya venir normalizado o venir con otra semantica.

### Tareas

#### 3.1 Confirmar semantica con negocio o con la fuente original

Documentar por escrito:

- que representa el valor de mes en el CSV
- si el valor entra como mes calendario humano o como indice de arreglo
- si el destino en AppSheet espera el mismo valor o uno transformado

#### 3.2 Revisar la conversion actual

Evaluar si la suma `+1` es correcta o si produce corrimiento.

Escenarios a validar:

- CSV ya trae `1..12`
- CSV trae `0..11`
- CSV trae texto o campos mixtos

#### 3.3 Introducir pruebas unitarias de contrato

Casos minimos:

- entrada `0`
- entrada `1`
- entrada `11`
- entrada `12`
- entrada vacia
- entrada no numerica

#### 3.4 Validar la migracion completa

Ejecutar un caso de muestra desde `casaley_stores.csv` y verificar:

- valor almacenado en AppSheet
- valor mostrado en UI
- valor consultado por cache

#### 3.5 Aislar la transformacion

Si se confirma que el contrato cambia segun el origen, conviene separar:

- normalizacion de lectura CSV
- normalizacion de persistencia

Esto evita mezclar semanticas en una sola funcion.

### Criterios de aceptacion

- El mes persiste y se visualiza en el mes correcto.
- No existe corrimiento entre CSV, AppSheet y UI.
- Hay pruebas que protegen la conversion.

### Riesgos

- Corregir la funcion sin validar el origen puede mover el error de lugar.
- Si el CSV mezcla formatos, el contrato debe documentarse por fuente.

---

## Epica 4: Definir fuente de verdad y ciclo de vida de CSV locales

### Objetivo

Dejar claro si los CSV locales siguen vivos, son respaldo o son legado.

### Estado actual observado

- El runtime de Planeacion consulta AppSheet.
- El CSV local se usa en migracion.
- `csvStore.js` existe, pero no parece ser la fuente primaria del runtime.

### Tareas

#### 4.1 Levantar inventario de usos

Identificar:

- donde se lee `branches.csv`
- donde se escribe `branches.csv`
- donde se lee `casaley_stores.csv`
- si hay scripts o tareas externas que dependan de estos archivos

#### 4.2 Clasificar cada artefacto

Definir etiqueta por archivo o modulo:

- `activo`
- `legacy`
- `migracion`
- `retirar`

#### 4.3 Documentar la decision

Redactar una nota tecnica que explique:

- AppSheet es la fuente de verdad operativa
- el CSV local es insumo de migracion o respaldo
- el cache local es solo cache runtime

#### 4.4 Decidir si `csvStore.js` sigue siendo necesario

Si no hay uso productivo:

- planificar su deprecacion
- eliminarlo en una ventana controlada

Si sigue siendo necesario:

- documentar el flujo exacto
- documentar su owner
- documentar su motivo de existencia

### Criterios de aceptacion

- Cualquier miembro del equipo puede identificar rapidamente la fuente de verdad.
- No existe ambiguedad operativa entre AppSheet y CSV.
- Los artefactos legacy quedan documentados o retirados.

### Riesgos

- Borrar archivos sin confirmar dependencias ocultas.
- Mantener legacy sin documentar genera confusion recurrente.

---

## Epica 5: Endurecimiento y documentacion operativa

### Objetivo

Cerrar el ciclo con monitoreo, pruebas y documentacion que sostenga la solucion.

### Tareas

#### 5.1 Agregar pruebas de regresion

Cobertura prioritaria:

- ruta base de WhatsApp Capacitadores
- jobs criticos
- migracion de mes
- endpoints de Planeacion

#### 5.2 Documentar endpoints y responsabilidades

Incluir:

- que expone cada modulo
- quien es la fuente de verdad
- que rutas son de uso humano y cuales son operativas

#### 5.3 Revisar observabilidad

Definir si el sistema necesita:

- metricas
- logs estructurados
- alertas
- reportes de health por modulo

#### 5.4 Preparar plan de despliegue

Antes de liberar:

- validar en ambiente de prueba o staging si existe
- ejecutar smoke tests
- revisar que no existan rutas rotas
- confirmar que jobs y Planeacion siguen operando

### Criterios de aceptacion

- Existe una base documental util para soporte y mantenimiento.
- El sistema queda con pruebas que protegen los puntos corregidos.
- Hay plan de despliegue y rollback razonable.

---

## Backlog tecnico propuesto

### Alta prioridad

1. Crear landing o redirect para `/whatsapp-capacitadores`.
2. Separar y exponer mejor el estado de jobs criticos.
3. Corregir el contrato del mes de Planeacion.

### Prioridad media

4. Documentar AppSheet como fuente de verdad.
5. Clasificar CSV locales como activos, legacy o migracion.
6. Agregar pruebas de regresion.

### Prioridad baja pero recomendable

7. Formalizar alertas o tableros de jobs.
8. Retirar codigo legacy no usado.

---

## Propuesta de secuencia de ejecucion

### Sprint o bloque 1

- Resolver `/whatsapp-capacitadores`.
- Agregar prueba de ruta.
- Revisar router y portal para coherencia de links.

### Sprint o bloque 2

- Inventario y clasificacion de jobs.
- Endpoint o vista de estado por job.
- Mejora de retries y trazabilidad.

### Sprint o bloque 3

- Validacion del mes de Planeacion con negocio.
- Fix de normalizacion si aplica.
- Pruebas unitarias y de integracion.

### Sprint o bloque 4

- Documentacion de fuente de verdad.
- Decision sobre CSV legacy.
- Limpieza controlada.

---

## Definicion de terminado

Una tarea se considera terminada cuando:

- el cambio esta implementado,
- existe prueba o evidencia de verificacion,
- la documentacion refleja el estado final,
- y el comportamiento previo roto o ambiguo queda corregido o explicitamente justificado.

## Riesgos transversales

- Cambiar logica de migracion sin revisar datos historicos.
- Resolver incidentes de forma puntual sin dejar trazabilidad.
- Dejar la documentacion para despues de desplegar.
- Eliminar CSV o helpers antes de confirmar dependencias.

## Recomendacion final

La solucion debe ejecutarse en este orden:

1. Ruta base de WhatsApp Capacitadores.
2. Estabilidad y visibilidad de jobs.
3. Contrato del mes de Planeacion.
4. Documentacion y limpieza de CSV legacy.

Ese orden reduce riesgo y da visibilidad temprana sobre el mayor dolor operativo.

## Estado de implementacion

Implementado en codigo:

- Ruta base de WhatsApp Capacitadores con landing funcional.
- Endpoint de health y vista de acceso para el modulo.
- Tracker ligero de ejecuciones de jobs con historial corto en memoria.
- Endpoint `/jobs/health` para separar salud operativa de la lista general.
- Endpoint `/jobs/history/:jobId` para revisar ejecuciones recientes.
- Contrato de mes de Planeacion endurecido para evitar corrimientos silenciosos.
- Migracion de Planeacion con validacion explicita de mes invalido.
- Pruebas automatizadas de contrato para WhatsApp, jobs y Planeacion.

Pendiente para una fase posterior:

- Documentacion formal de la vigencia de CSV legacy, si el equipo quiere retirarlos.
- Persistencia historica de jobs si se necesita auditar ejecuciones entre reinicios.
- Alertamiento externo o tablero de monitoreo, si no existe ya en infraestructura.
