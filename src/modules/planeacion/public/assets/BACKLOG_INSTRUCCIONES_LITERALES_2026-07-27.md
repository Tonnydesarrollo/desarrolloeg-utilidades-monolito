# Instrucciones Literales de Desarrollo - UI/UX

Fecha: 2026-07-27

Objetivo:
Dejar instrucciones inequívocas para implementar el backlog visual del portal Desarrollo EG sin interpretar de mas ni cambiar alcance.

Alcance:
- Dashboard autenticado
- Login y shell comun del portal
- Jobs
- WhatsApp Capacitadores
- Planeacion Ley
- Solventaciones
- Facturacion
- Pedidos

## Reglas generales

1. Reutilizar `portal-shell.css` en todas las superficies nuevas o modificadas.
2. Mantener `skip-link`, `role="main"` y un `h1` visible en toda superficie principal.
3. No introducir una segunda identidad visual distinta por modulo.
4. No eliminar funcionalidad existente salvo que esta instruccion lo pida de forma expresa.
5. No cambiar rutas publicas existentes.
6. No introducir textos tecnicos visibles al usuario final si el modulo es de uso humano.
7. No dejar texto con encoding roto. Corregir todo `Ã`, `Â` o mojibake visible.
8. Si una pantalla tiene accion primaria, esa accion debe verse antes que las acciones secundarias.
9. Si una pantalla necesita retorno, el retorno debe estar visible sin hacer scroll.

## 1. Shell comun del portal

### Archivo principal
- `src/public/ui/portal-shell.css`

### Instrucciones
1. Usar esta hoja como base para todos los modulos del portal.
2. Mantener una sola familia de estilos para:
   - fondo
   - contenedores
   - cards
   - botones
   - chips
   - estados vacios
   - loader
3. Asegurar que `portal-shell` funcione igual en:
   - `portal-home`
   - `portal-auth`
   - `portal-jobs`
   - `portal-whatsapp`
   - `portal-planeacion`
   - `portal-solventaciones`
   - `portal-facturacion`

### No hacer
- No crear un set visual nuevo por modulo.
- No mezclar tipografias ajenas sin motivo funcional.

## 2. Login y home

### Archivos
- `src/modules/home/home.router.js`

### Instrucciones
1. Mantener `renderLoginPage()` con:
   - `body class="portal-shell portal-auth"`
   - `skip-link`
   - `main#login-main`
   - `h1` visible
2. Mantener el acceso QA con token como opcion secundaria de pruebas.
3. No mover el acceso Google fuera del primer bloque visible.
4. Mantener el dashboard autenticado con la clase `dashboard-main`.
5. En el dashboard, dejar exactamente esta jerarquia visual:
   - hero de orientacion
   - accesos internos
   - acciones principales
   - utilidades secundarias
6. Mantener `Acciones principales` arriba y `Utilidades secundarias` plegables o visualmente rebajadas.
7. No volver a mostrar todas las tarjetas al mismo nivel visual.
8. Mantener el dashboard como home principal del usuario autenticado.

### Criterio de cumplimiento
- Un usuario nuevo entiende en un vistazo donde esta, que puede hacer primero y que queda como soporte.

### No hacer
- No volver a una grilla plana de accesos sin jerarquia.
- No quitar el retorno del dashboard.

## 3. Pedidos admin

### Archivos
- `src/modules/pedidos-ley/pedidosLey.admin.page.js`
- `src/modules/home/home.router.js`

### Instrucciones
1. Corregir todo texto roto en `Pedidos Admin`.
2. Mantener `skip-link`, `main` y `Volver al dashboard`.
3. El panel debe seguir dentro de `portal-shell`.
4. El panel debe verse como una pantalla de gestion, no como un formulario legado.
5. Eliminar cualquier caracter mojibake en:
   - titulos
   - subtitulos
   - tooltips
   - descripciones
   - pies de pagina
6. Mantener la lectura por filtros y cobertura, pero reducir ruido visual inicial.
7. Si hay demasiados bloques visibles, plegar los secundarios y dejar primero el resumen.

### Criterio de cumplimiento
- QA no debe encontrar `Ã`, `Â` ni caracteres rotos en ninguna parte del panel.

### No hacer
- No quitar filtros.
- No quitar la vista de cobertura.
- No quitar el retorno al dashboard.

## 4. Jobs

### Archivo
- `src/modules/jobs/jobs.router.js`

### Instrucciones
1. Mantener `body class="portal-shell portal-jobs"`.
2. Mantener `skip-link` y `main#jobs-main`.
3. Mantener la vista humana `Jobs operativos`.
4. Mantener la separacion entre:
   - lectura humana en `/jobs/view`
   - contrato tecnico en `/jobs`
5. Mantener las tarjetas con:
   - titulo
   - estado
   - resumen
   - detalle tecnico desplegable
   - acciones
6. Cambiar cualquier copy que siga sin acento o con encoding roto.
7. Uniformar el color de estados para que el sistema se vea consistente con el resto del portal.
8. Si el boton principal no es para volver, documentar el retorno con una accion clara visible.

### Criterio de cumplimiento
- La vista debe sentirse nativa del portal y no un panel aislado.

### No hacer
- No convertir `/jobs/view` en JSON.
- No quitar `/jobs` como contrato tecnico.

## 5. WhatsApp Capacitadores

### Archivo
- `src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js`

### Instrucciones
1. Mantener `portal-shell` en la landing y en el QR.
2. Mantener `skip-link`, `main`, `h1` visible y acciones principales.
3. Conservar estos accesos:
   - `Abrir QR`
   - `Ver health`
   - `Volver al portal`
4. En la vista QR, conservar:
   - `Actualizar QR`
   - `Volver al inicio`
   - `Ver health`
   - `Reiniciar sesion`
5. No ocultar la navegacion de retorno.
6. No cambiar la simpleza funcional del modulo.
7. Corregir cualquier texto con encoding roto, incluido:
   - señal
   - sesión
   - conexión
   - impresión

### Criterio de cumplimiento
- El usuario nunca debe quedar atrapado en QR ni perder la salida.

### No hacer
- No añadir paneles complejos innecesarios.
- No romper la landing minimalista.

## 6. Planeacion Ley

### Archivos
- `src/modules/planeacion/public/index.html`
- `src/modules/planeacion/public/assets/planeacion-official-theme.css`
- `src/modules/planeacion/public/assets/index-DXGJThHF.js`

### Instrucciones
1. Mantener `portal-shell` y `planeacion-official`.
2. Mantener `skip-link` y `main#root`.
3. No romper la app SPA.
4. Mantener la estetica actual de Planeacion, pero hacerla mas coherente con el portal.
5. Mantener el encabezado, tarjetas, chips y calendario con la misma base de tokens.
6. Si existe accion de retorno dentro del SPA, hacerla visible en la primera capa.
7. No quitar la logica de meses, calendarios, filtros ni geocodificacion.
8. Si hay texto roto en el bundle o en el HTML, corregirlo antes de publicar.

### Criterio de cumplimiento
- La pagina debe seguir sintiendose como la misma aplicacion, pero no como una isla visual.

### No hacer
- No romper el render SPA.
- No quitar los landmarks de accesibilidad.

## 7. Solventaciones

### Archivo
- `src/modules/solventaciones/views/solventaciones.ejs`

### Instrucciones
1. Mantener `portal-shell`, `skip-link`, `main#solventaciones-main` y `h1`.
2. Mantener el boton o enlace `Volver al dashboard`.
3. Corregir el footer para que no muestre `Â·` ni caracteres rotos.
4. Mantener la estructura de:
   - hero
   - stats
   - content
   - grupos
5. No reducir la utilidad de filtros ni resultados.
6. Mantener la estetica documental, pero dentro del lenguaje del portal.
7. Corregir cualquier mojibake visible en:
   - footer
   - subtitulos
   - tags
   - mensajes de estado

### Criterio de cumplimiento
- La pantalla debe verse terminada y consistente, no parchada.

### No hacer
- No quitar filtros.
- No quitar el PDF.
- No quitar el regreso al dashboard.

## 8. Facturacion

### Archivos
- `src/modules/facturacion/views/cotizacion_editable.ejs`
- `src/modules/facturacion/views/cotizacion.ejs`
- `src/modules/facturacion/views/cotizacion_ley.ejs`
- `src/modules/facturacion/facturacion.router.js`

### Instrucciones
1. Mantener `portal-shell` en las tres vistas.
2. Mantener `skip-link`, `main` y retorno visible al dashboard.
3. Corregir toda referencia textual con encoding roto.
4. Unificar el estilo general de estas pantallas hacia la shell comun del portal.
5. Mantener la utilidad de edicion, impresion y guardado a PDF.
6. No quitar la logica de cotizacion ni de plantilla ley.
7. Si una vista sigue usando un lenguaje demasiado legacy, reducirlo sin romper el PDF.
8. Dejar claro el titulo de pagina y la accion principal.

### Criterio de cumplimiento
- Facturacion debe sentirse parte del mismo portal, no una aplicacion externa incrustada.

### No hacer
- No romper la salida PDF.
- No eliminar el flujo de edicion.

## 9. Dashboard pedidos y copy roto

### Archivos
- `src/modules/pedidos-ley/pedidosLey.admin.page.js`
- `src/modules/home/home.router.js`
- `src/modules/jobs/views/pedidos_manual.ejs`

### Instrucciones
1. Buscar y corregir todo mojibake.
2. Revisar el flujo de `dashboard/pedidos` y de la vista manual.
3. Mantener el retorno visible.
4. Mantener la semantica de panel, resumen y detalle.
5. Hacer una pasada completa de encoding en todos los textos visibles.

### Criterio de cumplimiento
- Ninguna pantalla de pedidos debe mostrar caracteres corruptos en QA ni en produccion.

### No hacer
- No dejar el problema como "detalle menor".

## 10. Definicion de cierre visual

### La tarea se considera terminada solo si:
1. Dashboard, jobs, whatsapp, planeacion, solventaciones y facturacion usan la misma base visual.
2. Ninguna superficie clave muestra mojibake.
3. Todas las superficies principales tienen `skip-link`, `main` y regreso visible.
4. El dashboard deja de sentirse sobrecargado en la primera lectura.
5. `facturacion/cotizacion/html` deja de verse como una app aparte.

## 11. Orden de ejecucion

1. Corregir encoding visible en pedidos y solventaciones.
2. Terminar unificacion visual del dashboard.
3. Homologar facturacion.
4. Mantener jobs y whatsapp dentro del mismo lenguaje del portal.
5. Pulir Planeacion sin romper la SPA.
6. Documentar tokens visuales y patrones de retorno.

## 12. Regla de QA

Cada cambio debe validarse en:
- `https://apps.desarrolloeg.com/dashboard`
- `https://apps.desarrolloeg.com/jobs/view`
- `https://apps.desarrolloeg.com/whatsapp-capacitadores`
- `https://apps.desarrolloeg.com/whatsapp-capacitadores/qr`
- `https://apps.desarrolloeg.com/Planeacion-ley/`
- `https://apps.desarrolloeg.com/SOLVENTACIONES/html`
- `https://apps.desarrolloeg.com/facturacion/cotizacion/html`
- `https://apps.desarrolloeg.com/dashboard/pedidos`

La validacion debe confirmar:
- sin mojibake
- con retorno visible
- con jerarquia clara
- con accion principal evidente

