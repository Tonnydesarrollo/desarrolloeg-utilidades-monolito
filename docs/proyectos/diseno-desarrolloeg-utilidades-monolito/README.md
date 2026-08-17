# Proyecto de Diseno UI/UX

**Nombre:** Renovacion visual de `desarrolloeg_utilidades_monolito`  
**Fecha:** 2026-07-30  
**Fuente de analisis:** QA en `https://apps.desarrolloeg.com/QA` y revision del portal local.

## Objetivo

Redisenar toda la experiencia del portal para que se sienta como un solo producto, no como muchas herramientas pegadas entre si.

La meta no es solo "verse mejor". La meta es:

- hacer mas clara la jerarquia,
- reducir la densidad visual,
- unificar login, dashboard y modulos,
- mejorar la percepcion de velocidad,
- y dejar un sistema reutilizable para pantallas nuevas.

## Lo que ya entendimos del producto

En QA, el acceso funciona con una sesion administrativa temporal y el dashboard principal ya expone estas familias:

- Calendario
- Capacitadores
- Accesos internos
- Pedidos
- Faltantes

Ademas, el portal contiene modulos fuertes como:

- `jobs/view`
- `whatsapp-capacitadores`
- `Planeacion-ley/`
- `dashboard/pedidos`
- `facturacion/cotizacion/html`
- `SOLVENTACIONES/html`
- `CONSTANCIAS/`
- `SUCURSALES-DOCS/`
- `FALTANTES-LEY/`
- `POLIZA_LEY/`
- `SEPARAR-PIPC/`
- `contabilidad`

## Problema de diseno actual

La base funcional ya existe, pero la experiencia aun mezcla demasiados lenguajes visuales:

- distintos niveles de densidad,
- variaciones de color y sombra,
- jerarquias inconsistentes,
- pantallas que se sienten mas "herramienta interna" que "sistema disenado",
- y algunos modulos todavia cargan una estetica heredada o muy tecnica.

## Criterios del redisenio

- Una sola base visual compartida.
- Una accion principal por pantalla o bloque.
- Regreso visible al dashboard o a la pantalla padre.
- Estados vacios, de carga y de error consistentes.
- Accesibilidad real: contraste, foco visible, `main`, `h1`, targets tactiles.
- Responsive primero en moviles y tabletas, sin romper escritorio.

## Principios que guian la propuesta

### Material Design

- Elevacion moderada, no decorativa.
- Componentes claros con estados visibles.
- Jerarquia por color, superficie y tamano.
- Espaciado consistente sobre el 8pt grid.

### Apple HIG

- Claridad antes que ornamento.
- Deferencia al contenido.
- Profundidad sutil para organizar capas.
- Controles simples, con enfasis en legibilidad y navegacion predecible.

### Nielsen

- Visibilidad del estado del sistema.
- Consistencia y estandares.
- Prevencion de errores.
- Reconocimiento antes que memoria.
- Control y libertad del usuario.

## Tres propuestas de direccion visual

### 1. Centro de Control Editorial

**Idea:** una interfaz sobria, premium y muy legible, con sensacion de "panel ejecutivo".

**Rasgos:**

- fondos suaves con gradientes discretos,
- tarjetas grandes y bien espaciadas,
- tipografia fuerte en titulos,
- acciones claras y pocas por bloque,
- uso de color como acento, no como ruido.

**Ideal para:**

- dashboard,
- status,
- jobs,
- planeacion,
- facturacion.

**Ventaja:** es la opcion mas clara para ordenar todo el portal.

### 2. Grid Operativo Compacto

**Idea:** priorizar rapidez de lectura y densidad controlada, con un estilo mas tecnico.

**Rasgos:**

- tarjetas compactas,
- mas informacion visible por pantalla,
- navegacion muy directa,
- fuerte organizacion por familias.

**Ideal para:**

- utilidades internas,
- dashboards con alta carga informativa,
- vistas de seguimiento.

**Ventaja:** maximiza eficiencia para usuarios frecuentes.

### 3. Suite Institucional Suave

**Idea:** una interfaz mas calida y corporativa, con textura visual ligera y mas presencia de marca.

**Rasgos:**

- superficies mas suaves,
- tonos calidos y neutrales,
- enfasis en identidad institucional,
- sensacion mas cercana a documentacion/servicio.

**Ideal para:**

- login,
- constancias,
- documentos,
- paginas de soporte o salida de PDF.

**Ventaja:** transmite confianza y formalidad.

## Direccion recomendada

**Recomiendo adoptar la opcion 1: Centro de Control Editorial.**

Es la que mejor resuelve el problema principal del producto:

- hoy el sistema tiene muchas utilidades, pero necesita orden;
- el usuario debe entender primero donde esta y que puede hacer;
- despues, los detalles tecnicos o secundarios deben poder expandirse sin saturar.

## Sistema visual propuesto

### Paleta

#### Neutros

- Fondo principal: `#F5F7FA`
- Superficie: `#FFFFFF`
- Superficie suave: `#F8FAFC`
- Texto principal: `#15202B`
- Texto secundario: `#5F6D7A`
- Linea/borde: `rgba(21, 32, 43, 0.10)`

#### Marca y acentos

- Azul profundo: `#1D4ED8`
- Teal institucional: `#0F4C5C`
- Rojo acento: `#C0392B`
- Verde operativo: `#166534`
- Ambar de alerta: `#B45309`

#### Semantica

- Exito: verde
- Advertencia: ambar
- Error: rojo
- Informacion: azul
- Neutral: gris/azul suave

### Tipografia

**Propuesta base:**

- Titulos: `Manrope` o `Sora`
- Cuerpo/UI: `Inter`
- Monoespaciada: `JetBrains Mono`

**Criterio:**

- titulos con peso 700-800,
- cuerpo entre 15 y 16 px en desktop,
- line-height comodo,
- mayusculas solo para etiquetas cortas, no para contenido largo.

### Espaciado

- Escala base de 8 px.
- Padding minimo util: 16 px.
- Tarjetas y paneles: 20-28 px.
- Separacion entre bloques grandes: 24-32 px.

### Bordes y profundidad

- Radio estandar: 18-24 px en superficies principales.
- Radio de chip/boton: 999 px cuando sea tipo pill.
- Sombras suaves, sin efecto "flotante pesado".
- Separacion por borde + fondo + sombra ligera, no por saturacion de color.

## Estructura de pantalla recomendada

### Login

- Panel unico centrado.
- Mensaje corto y claro.
- Un solo CTA principal.
- Acceso QA visible solo en entorno QA.

### Dashboard

- Hero con contexto y proposito.
- Acciones principales primero.
- Familia de herramientas secundarias despues.
- Controles de retorno y ayuda visibles.
- Menos tarjetas por pantalla, mas orden.

### Modulos operativos

- Encabezado con titulo + contexto + salida.
- Una accion principal por vista.
- Detalles tecnicos dentro de acordeones o paneles secundarios.
- Estado de carga explicito.

### Vistas densas

- Filtros agrupados.
- Chips o tabs para segmentacion.
- Resumenes arriba, detalle debajo.
- Evitar listas largas sin jerarquia.

## Propuesta responsive

### Mobile

- Una columna por defecto.
- Botones de ancho completo.
- Menu o tabs con scroll horizontal controlado.
- Resumenes compactos antes del detalle.

### Tablet

- Dos columnas cuando el contenido lo permita.
- Tarjetas en grid equilibrado.
- Filtros en bloques colapsables.

### Desktop

- Grid mas amplio, pero con maximo legible.
- Evitar que las tarjetas se estiren demasiado.
- Hero y paneles en composicion asimetrica ligera.

## Componentes que deben quedar estandarizados

- `hero`
- `panel`
- `card`
- `button primary`
- `button secondary`
- `chip`
- `pill`
- `empty state`
- `loader`
- `status badge`
- `return link`
- `details / accordion`

## Entregables de este proyecto

1. Sistema visual base.
2. Propuesta de dashboard renovado.
3. Propuesta de login unificado.
4. Guia de componentes reutilizables.
5. Propuesta responsive por tipo de pantalla.
6. Reglas de accesibilidad y retorno.
7. Mapa de pantallas priorizadas para redisenio.

## Orden sugerido de ejecucion

1. Dashboard principal.
2. Login y acceso QA.
3. Shell visual comun.
4. `jobs/view` y `status`.
5. `facturacion/cotizacion/html`.
6. `SOLVENTACIONES/html`.
7. `whatsapp-capacitadores`.
8. `Planeacion-ley/`.
9. Modulos ligeros y utilidades documentales.

## Criterio de exito

La renovacion estara bien resuelta si un usuario puede:

- entrar sin dudas,
- entender la pantalla en menos de 5 segundos,
- identificar la accion principal de inmediato,
- volver al nivel anterior sin pensar,
- y sentir que todo el portal pertenece a un mismo sistema.

## Maqueta de alta fidelidad

La propuesta visual de login y dashboard esta disponible aqui:

- [Prototipo HTML](/C:/Users/devssh/Documents/Programacion/DESARROLLOEG_UTILIDADES_MONOLITO/docs/proyectos/diseno-desarrolloeg-utilidades-monolito/high-fidelity/index.html)

## Brief tecnico para frontend

La guia accionable para implementar login y dashboard esta aqui:

- [Brief tecnico frontend](/C:/Users/devssh/Documents/Programacion/DESARROLLOEG_UTILIDADES_MONOLITO/docs/proyectos/diseno-desarrolloeg-utilidades-monolito/BRIEF_TECNICO_FRONTEND.md)
