# Ticket tecnico: Redisenar login del portal

**Objetivo**
Redisenar el login como una pieza de marca independiente, respetando los colores institucionales y el estilo del logo de Desarrollo EG. El login no necesita alinearse al dashboard por ahora.

**Alcance**
- Replantear el login como composicion de marca, no solo como formulario.
- Dar mayor presencia al bloque del logo.
- Mantener el acceso principal con Google como CTA dominante.
- Mantener el acceso QA como accion secundaria, visible pero menos protagonica.
- Preservar el flujo funcional actual.

**Direccion visual**
- Basarse en la paleta institucional de la empresa.
- Tomar el logo como referencia principal para color, tono y presencia.
- Evitar look generico tipo SaaS.
- Evitar una estetica plana o excesivamente neutra.
- Usar profundidad sutil, bordes suaves y tarjetas bien definidas.

**Estructura requerida**
- Desktop: dos columnas.
- Izquierda: bloque de marca con logo, mensaje corto y fondo expresivo.
- Derecha: formulario limpio, claro y de alta legibilidad.
- Mobile: una sola columna, con marca arriba y formulario debajo.

**Tipografia**
- Titulo con mas personalidad y presencia.
- UI y labels muy legibles.
- Mantener consistencia en botones, ayudas y estados.

**Accesibilidad**
- Mantener `skip-link`.
- Mantener `main#login-main`.
- Mantener `role="alert"` y `aria-live` para errores.
- Mantener estados `:focus-visible` en botones e inputs.
- Conservar contraste suficiente en texto y CTAs.

**Archivos a revisar**
- `src/modules/home/home.router.js`
- `src/public/ui/portal-shell.css`

**No hacer**
- No copiar la estetica del dashboard.
- No convertir el login en una pantalla corporativa generica.
- No ocultar el acceso QA.
- No romper la estructura funcional actual.

**Criterios de aceptacion**
- El login debe sentirse mas propio de Desarrollo EG.
- El usuario debe reconocer la marca al entrar.
- El CTA principal debe dominar visualmente.
- QA debe existir, pero como opcion secundaria.
- El diseno debe verse intencional, premium e institucional.

