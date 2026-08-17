# Brief tecnico para frontend

Proyecto: `desarrolloeg_utilidades_monolito`
Fecha: 2026-07-30
Objetivo: ajustar login y dashboard para que mantengan la estetica editorial del portal, pero sin romper la base visual compartida.

## Problema a resolver

El login se ve mas personalizado, pero quedo demasiado aislado de la base comun del portal.
El dashboard debe conservar la jerarquia editorial ya lograda y el login debe sentirse como la misma familia visual.

La regla principal es esta:

- `portal-shell.css` sigue siendo la base comun.
- `getHomeStyles()` solo debe aportar variaciones del login, no rehacer el sistema visual.

## Archivos a tocar

1. `src/modules/home/home.router.js`
2. `src/public/ui/portal-shell.css`

## Cambios solicitados en `src/modules/home/home.router.js`

### 1. Mantener el login dentro del shell comun

- Renderizar el login con `body.portal-shell` y `portal-auth`.
- Seguir cargando `src/public/ui/portal-shell.css` en la pagina de login.
- No mover la logica del login a una hoja aislada.

### 2. Dejar el estilo del login como una capa de variacion

- Conservar en `getHomeStyles()` solo lo especifico del auth:
  - composicion de dos columnas,
  - panel de marca,
  - panel de formulario,
  - hero visual del login,
  - boton principal y boton secundario,
  - estados de mensaje.
- Evitar redefinir otra vez:
  - la paleta completa,
  - la base tipografica del portal,
  - cards, paneles y botones genericos,
  - reglas globales que ya viven en `portal-shell.css`.

### 3. Recuperar accesibilidad visual

- Agregar o conservar `:focus-visible` para:
  - `skip-link`,
  - `submit-btn`,
  - `secondary-btn`,
  - inputs del formulario.
- Mantener contraste alto en texto, badges y placeholders.
- Conservar `main#login-main` y `aria-label`/`aria-describedby`.
- Mantener el mensaje de error con `role="alert"` y `aria-live`.

### 4. Mantener la jerarquia editorial

- Titulo principal con mas peso visual.
- Panel izquierdo del login con:
  - fondo oscuro o navy,
  - degradado sutil,
  - logo,
  - badge de contexto,
  - titulo fuerte.
- Panel derecho con:
  - fondo blanco,
  - formulario limpio,
  - boton principal destacado,
  - CTA QA secundario.

### 5. Ajustes responsive

- En desktop:
  - conservar dos columnas.
  - mantener el panel visual y el formulario visibles al mismo tiempo.
- En tablet y mobile:
  - apilar columnas.
  - hacer que los botones ocupen ancho completo.
  - conservar el orden: titulo, contexto, accion principal, accion secundaria.

## Cambios solicitados en `src/public/ui/portal-shell.css`

### 1. Seguir como base comun

- No convertir esta hoja en una capa exclusiva de login.
- Mantenerla como la base para:
  - dashboard,
  - modulos,
  - login,
  - estados vacios,
  - botones,
  - paneles,
  - formularios.

### 2. Conservar tokens del sistema

- Mantener los tokens ya definidos:
  - `--portal-font-display`
  - `--portal-font-ui`
  - `--portal-font-body`
  - `--portal-bg`
  - `--portal-surface`
  - `--portal-ink`
  - `--portal-muted`
  - `--portal-line`
  - `--portal-shadow`
  - `--portal-accent`
  - `--portal-accent-2`
  - `--portal-accent-3`

### 3. Asegurar consistencia tipografica

- `Cinzel` para titulos y nombres de seccion.
- `Montserrat` para UI, labels, chips, botones y microcopy.
- `Inter` para cuerpo y texto largo.

### 4. Asegurar foco y estados

- Mantener foco visible en:
  - links,
  - botones,
  - inputs,
  - selects,
  - textareas.
- Asegurar que los estados hover y focus no compitan entre si.

## Direccion visual que debe respetarse

La estetica correcta para este portal es:

- fondo calido y editorial,
- acento navy/crimson,
- cards blancas con profundidad suave,
- hero con presencia,
- botones claramente jerarquizados,
- lenguaje mas institucional que SaaS generico.

No se debe convertir en:

- una app neutral tipo dashboard corporativo generico,
- una landing minima sin identidad,
- ni una pantalla con estilos duplicados y no compartidos.

## Ajustes de contenido para el login

### Texto recomendado

- Titulo: `Portal de Desarrollo EG`
- Subtitulo: `Entrada institucional para acceder al portal y continuar hacia el tablero sin perder contexto.`
- Ayuda principal: `Usa tu cuenta corporativa de Google para entrar al dashboard.`
- Ayuda QA: `Usa este acceso solo para validar tickets con sesion de administracion.`

### Orden visual recomendado

1. Badge de contexto.
2. Logo.
3. Titulo principal.
4. Subtitulo.
5. Formulario de acceso.
6. CTA principal.
7. CTA QA.
8. Mensaje de estado.

## Criterios de aceptacion

- Login y dashboard deben sentirse del mismo sistema.
- El login puede tener personalidad propia, pero no debe parecer otra app.
- La home autenticada debe seguir leyendo como tablero principal en menos de 5 segundos.
- Ningun cambio debe romper accesibilidad de teclado.
- Ningun cambio debe eliminar el retorno visible al dashboard o al login.

## Checklist de revision visual

- [ ] El login conserva dos columnas en desktop.
- [ ] El login apila correctamente en mobile.
- [ ] Los botones ocupan ancho completo en mobile.
- [ ] Hay foco visible en todos los controles.
- [ ] El acceso QA sigue siendo secundario.
- [ ] El dashboard conserva la jerarquia editorial.
- [ ] No hay estilos duplicados que contradigan `portal-shell.css`.
- [ ] La pagina sigue sintiendose parte del mismo portal.

