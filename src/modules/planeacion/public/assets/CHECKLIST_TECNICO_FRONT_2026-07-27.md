# Checklist Tecnico Front - UI/UX Desarrollo EG

Fecha: 2026-07-27

Objetivo:
Ejecutar el backlog visual sin ambiguedad, con verificacion tecnica por archivo y por superficie.

## Base comun del portal

- [ ] `src/public/ui/portal-shell.css` esta presente y es referenciado por todas las superficies principales.
- [ ] Todas las superficies nuevas o modificadas usan `body class="portal-shell ..."` segun el modulo.
- [ ] Todas las superficies principales incluyen `skip-link`.
- [ ] Todas las superficies principales tienen `main` con `role="main"`.
- [ ] Todas las superficies principales muestran un `h1` visible.
- [ ] No hay texto con mojibake visible en ningun modulo revisado.
- [ ] Los botones, cards, chips, pills y loaders comparten estilo base.
- [ ] La experiencia de regreso usa un patron consistente.

## 1. Login y dashboard

### Archivos
- [ ] `src/modules/home/home.router.js`
- [ ] `src/modules/home/portalAuth.service.js` si aplica para datos de acceso

### Checklist
- [ ] `renderLoginPage()` usa `portal-shell portal-auth`.
- [ ] El login conserva acceso Google como accion principal.
- [ ] El acceso QA sigue disponible como opcion secundaria controlada.
- [ ] El login mantiene `skip-link` y `main#login-main`.
- [ ] El dashboard usa `dashboard-main`.
- [ ] El dashboard separa visualmente `Acciones principales` y `Utilidades secundarias`.
- [ ] `Utilidades secundarias` no compite al mismo nivel que las acciones principales.
- [ ] La densidad visual del dashboard se redujo respecto a la version anterior.
- [ ] El dashboard no vuelve a una rejilla plana de accesos.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/dashboard`
- [ ] `https://apps.desarrolloeg.com/login`

## 2. Pedidos admin

### Archivos
- [ ] `src/modules/pedidos-ley/pedidosLey.admin.page.js`
- [ ] `src/modules/home/home.router.js`

### Checklist
- [ ] `Pedidos Admin` mantiene `skip-link`, `main` y retorno visible.
- [ ] Todo texto visible esta limpio y sin encoding roto.
- [ ] El panel conserva resumen, filtros y cobertura.
- [ ] El panel sigue dentro de `portal-shell`.
- [ ] El retorno al dashboard sigue visible sin scroll.
- [ ] Los estados vacios y mensajes de ayuda tienen tono consistente.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/dashboard/pedidos`

## 3. Jobs

### Archivo
- [ ] `src/modules/jobs/jobs.router.js`

### Checklist
- [ ] `portal-shell portal-jobs` esta aplicado al `<body>`.
- [ ] `skip-link` y `main#jobs-main` existen.
- [ ] La vista humana `Jobs operativos` es la entrada visible.
- [ ] `/jobs` conserva el contrato tecnico JSON.
- [ ] `/jobs/view` conserva la lectura humana.
- [ ] Cada tarjeta muestra titulo, estado, resumen, detalle tecnico y acciones.
- [ ] Los estados usan una paleta coherente con el resto del portal.
- [ ] No hay textos sin acento o con mojibake.
- [ ] El modulo conserva su retorno visible al portal.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/jobs/view`
- [ ] `https://apps.desarrolloeg.com/jobs`

## 4. WhatsApp Capacitadores

### Archivo
- [ ] `src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js`

### Checklist
- [ ] La landing usa `portal-shell portal-whatsapp`.
- [ ] La landing incluye `skip-link`, `main` y `h1` visible.
- [ ] La landing muestra `Abrir QR` y `Ver health`.
- [ ] La landing muestra `Volver al portal`.
- [ ] La vista QR conserva `Actualizar QR`.
- [ ] La vista QR conserva `Volver al inicio`.
- [ ] La vista QR conserva `Ver health`.
- [ ] La vista QR conserva `Reiniciar sesion`.
- [ ] No existe mojibake en la landing ni en el QR.
- [ ] El modulo se sigue sintiendo simple y directo.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/whatsapp-capacitadores`
- [ ] `https://apps.desarrolloeg.com/whatsapp-capacitadores/qr`

## 5. Planeacion Ley

### Archivos
- [ ] `src/modules/planeacion/public/index.html`
- [ ] `src/modules/planeacion/public/assets/planeacion-official-theme.css`
- [ ] `src/modules/planeacion/public/assets/index-DXGJThHF.js`

### Checklist
- [ ] El HTML usa `portal-shell planeacion-official portal-planeacion`.
- [ ] Existe `skip-link` y `main#root`.
- [ ] La SPA sigue cargando correctamente.
- [ ] La shell visual es coherente con el portal.
- [ ] El encabezado y el calendario siguen funcionando.
- [ ] No se rompio la navegacion ni la geocodificacion.
- [ ] El regreso o salida visible es claro cuando aplica.
- [ ] No hay texto corrupto en la vista ni en el bundle.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/Planeacion-ley/`

## 6. Solventaciones

### Archivo
- [ ] `src/modules/solventaciones/views/solventaciones.ejs`

### Checklist
- [ ] El body usa `portal-shell portal-solventaciones`.
- [ ] Existe `skip-link` y `main#solventaciones-main`.
- [ ] El encabezado muestra `Volver al dashboard`.
- [ ] El footer ya no muestra `Â·` ni caracteres corruptos.
- [ ] Los filtros siguen funcionando.
- [ ] El PDF sigue disponible.
- [ ] La pantalla conserva la estructura hero + stats + content.
- [ ] La pantalla ya no se siente parchada.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/SOLVENTACIONES/html`

## 7. Facturacion

### Archivos
- [ ] `src/modules/facturacion/views/cotizacion_editable.ejs`
- [ ] `src/modules/facturacion/views/cotizacion.ejs`
- [ ] `src/modules/facturacion/views/cotizacion_ley.ejs`
- [ ] `src/modules/facturacion/facturacion.router.js`

### Checklist
- [ ] Las tres vistas usan `portal-shell portal-facturacion`.
- [ ] Las tres vistas tienen `skip-link`.
- [ ] Las tres vistas tienen `main` y retorno visible al dashboard.
- [ ] El contenido visible no tiene mojibake.
- [ ] La experiencia ya no se ve como una app externa incrustada.
- [ ] La edicion sigue funcionando.
- [ ] La impresion / PDF sigue funcionando.
- [ ] La plantilla ley sigue respetando su flujo actual.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/facturacion/cotizacion/html`

## 8. Dashboard pedidos y copy roto

### Archivos
- [ ] `src/modules/pedidos-ley/pedidosLey.admin.page.js`
- [ ] `src/modules/jobs/views/pedidos_manual.ejs`
- [ ] `src/modules/home/home.router.js`

### Checklist
- [ ] Se reviso todo texto visible relacionado con pedidos.
- [ ] No queda mojibake en paneles de pedidos.
- [ ] Los estados, ayudas y titulos estan normalizados.
- [ ] El retorno visible se mantiene.
- [ ] La vista manual de pedidos conserva su flujo guiado.

### Verificacion QA
- [ ] `https://apps.desarrolloeg.com/dashboard/pedidos`
- [ ] `https://apps.desarrolloeg.com/jobs/pedidos/manual`

## 9. Reglas de cierre tecnico

- [ ] Ninguna pantalla clave del portal muestra `Ã`, `Â` o `�`.
- [ ] Ninguna pantalla clave pierde `skip-link` o `main`.
- [ ] Ninguna pantalla clave pierde su accion principal visible.
- [ ] Ninguna pantalla clave pierde el retorno visible.
- [ ] Dashboard, jobs, whatsapp, planeacion, solventaciones y facturacion se sienten parte del mismo sistema.
- [ ] QA valida cada ruta en sesion autenticada antes de cerrar.

## 10. Orden recomendado de implementacion

- [ ] 1. Corregir encoding visible en pedidos y solventaciones.
- [ ] 2. Terminar unificacion visual del dashboard.
- [ ] 3. Homologar facturacion.
- [ ] 4. Unificar jobs y whatsapp con la shell comun.
- [ ] 5. Pulir Planeacion sin romper la SPA.
- [ ] 6. Documentar tokens visuales y patrones de retorno.

