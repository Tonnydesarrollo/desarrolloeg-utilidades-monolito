# Arquitectura alternativa: AppSheet + cache en backend + frontend por AJAX

Fecha: 2026-08-19

Actualizacion relacionada:

- `docs/arquitectura-portal-modulos-tiempo-real.md`: arquitectura vigente con BD local persistente, webhooks AppSheet, auditoria, SSE de tiempo real y matriz de permisos por puesto.

Este documento formaliza la rama arquitectonica alternativa para DesarrolloEG:

- AppSheet sigue siendo la base principal de datos operativa.
- El backend conserva una cache persistente y precargada al desplegar.
- El frontend consume esa cache por AJAX.
- Los jobs que nacen de fetch, archivos o procesos de negocio siguen persistiendo en local.
- El diseno visual toma como referencia el proyecto local `sistema_bolsa_trabajo`, que aporta el frontend.

## Objetivo

Reducir la carga inicial, evitar que cada usuario tenga que precargar datos y mantener una experiencia rapida y consistente sin abandonar AppSheet como fuente de verdad operativa.

## Principio rector

La fuente de verdad no se mueve:

- AppSheet conserva las tablas operativas que ya viven ahi.
- El backend cachea y consolida respuestas.
- El frontend solo presenta y ejecuta acciones, no recalienta el universo de datos en cada sesion.

## Capas

### 1. AppSheet como base principal

Uso:

- Altas, ediciones y bajas operativas.
- Tablas que ya nacen y viven en AppSheet.
- Auditoria funcional del cambio.

Regla:

- Si el dato es de negocio y se edita en AppSheet, AppSheet manda.
- Si el dato se sincroniza desde AppSheet, el backend lo replica y lo cachea.

### 2. Backend con cache persistente

La cache vive en el servidor, no en el navegador.

Uso:

- Precarga al desplegar o al levantar el contenedor.
- Respuesta rapida para el frontend.
- Reuso entre usuarios.
- Evitar que el primer usuario pague el costo de calentar datos.

Contenido:

- Catalogos consultados constantemente.
- Relaciones ya resueltas.
- Resultados de jobs frecuentes.
- Tablas de soporte que vienen de fetch, XML, PDFs o APIs externas.
- Vistas logicas o tablas derivadas que el frontend consume de forma repetida.

### 3. Jobs y procesos persistentes

Los jobs que ya existen y dependen de:

- fetch
- lectura de archivos
- XML
- PDFs
- APIs externas

se quedan persistentes en backend, porque ahi tiene sentido conservar estado entre despliegues y reintentos.

Ejemplos:

- Sincronizacion de CFDI.
- Extraccion de datos de PDF.
- Llenado de tablas derivadas.
- Reconciliacion de cambios pendientes.

### 4. Frontend por AJAX

El frontend no consulta AppSheet directo como primera opcion.

Flujo:

1. El usuario entra al portal.
2. El frontend pide datos por AJAX al backend.
3. El backend responde desde cache o desde una sincronizacion ya resuelta.
4. Si algo necesita refresco, el backend decide cuando recalcularlo.

Objetivo:

- Menos latencia.
- Menos llamadas repetidas.
- Menos dependencia de carga inicial por usuario.

## Flujo general

```text
AppSheet -> backend sync/cache -> AJAX frontend
            ^                    |
            |                    v
         jobs locales      usuario final
```

### Flujo de lectura

1. AppSheet mantiene la verdad operativa.
2. El backend sincroniza y normaliza.
3. El backend guarda cache.
4. El frontend consume cache por AJAX.

### Flujo de escritura

1. El usuario actua donde corresponda.
2. Si la accion es operativa de AppSheet, el cambio nace ahi.
3. Si la accion es local o de job, se persiste en backend.
4. El backend empuja de vuelta a AppSheet cuando aplique.

## Que queda en AppSheet

- Tablas operativas de negocio.
- Auditoria visible.
- Relaciones que ya se controlan ahi.
- Cambios que el usuario hace directamente.

## Que queda en backend

- Cache servida al frontend.
- Jobs persistentes.
- Tablas derivadas de APIs y archivos.
- Reconciliacion y reintento.
- Normalizacion de referencias.
- Respuestas agregadas para AJAX.

## Que no debe pasar

- No cargar la cache por navegador.
- No hacer que cada usuario reconstruya catalogos al entrar.
- No duplicar logica de negocio en frontend.
- No tocar el proyecto `sistema_bolsa_trabajo`.
- No usar ese repo como blanco de cambios; solo como referencia de frontend y experiencia visual.
- No mostrar textos de trabajo, notas internas, borradores ni explicaciones de arquitectura en la interfaz final.
- No usar cuadros tipo dialogo, callout, aviso interno o bloque de documentacion dentro del front.
- Si algo es tecnico, va en documentacion, logs, JSON o paneles plegables de diagnostico.

## Frontend de referencia

Tomamos como base conceptual el proyecto local `sistema_bolsa_trabajo` para:

- Estructura general del portal.
- Jerarquia de navegacion.
- Patrones de tarjetas, listados y accesos.
- Sensacion de producto unificado.

Adaptacion obligatoria:

- Colores institucionales de DesarrolloEG.
- Logos propios.
- Textos propios.
- Rutas propias.
- Modulos propios.

## Cache y precarga

### Al desplegar

- El backend levanta.
- La cache se precarga.
- Los endpoints quedan listos para servir datos inmediatamente.

### Al levantar contenedor

- Se rehidratan cache y estados minimos.
- Los jobs criticos se reanudan o se marcan para reintento.

### Durante operacion

- Se refresca cache por horario o por evento.
- Si un job modifica datos, marca cache y/o tablas derivadas como pendientes de refresco.

## Estrategia por tipo de dato

### Dato operativo de AppSheet

- Vive en AppSheet.
- Se replica en backend.
- Se sirve desde backend.

### Dato derivado

- Se calcula o consolida en backend.
- No se manda como editable si puede reconstruirse.

### Dato de job

- Se persiste localmente.
- Se actualiza por proceso.
- Se sincroniza a AppSheet solo si pertenece a una tabla que deba regresar.

## Beneficios

- Primera carga mas rapida.
- Menos dependencia de AppSheet por pantalla.
- Backend mas estable y reutilizable.
- Mejor experiencia para usuarios frecuentes.
- Mejor base para evolucionar el frontend sin romper el origen de datos.

## Riesgos que hay que controlar

- Cache obsoleta.
- Duplicidad de fuente de verdad.
- Confusion entre dato editable y dato derivado.
- Mezcla accidental de tablas manuales, sync y derivadas.

Mitigacion:

- Versionar el origen por tabla.
- Documentar que va por AppSheet, que va por job y que va por manual.
- Separar refresh de cache, sync operativo y sincronizacion puntual.

## Piezas del frontend local de referencia

En el proyecto local `sistema_bolsa_trabajo`, las piezas mas utiles como referencia son:

- `src/App.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/DesignLabPage.tsx`
- `src/components/AppNav.tsx`
- `src/components/PageHeader.tsx`
- `src/components/LoadingScreen.tsx`
- `src/index.css`

Ese proyecto sirve para copiar criterio visual, shell, navegacion y layout, no la logica de datos ni backend.

## Siguiente paso recomendado

1. Definir las tablas de cache persistente.
2. Definir el contrato AJAX del frontend.
3. Reutilizar el layout de bolsa como referencia visual.
4. Ajustar logos y colores institucionales.
5. Mapear que pantallas leen cache y cuales pegan a AppSheet.

## Contrato inicial ya disponible

Ya quedo expuesto un primer contrato de entrada para esta rama:

- `GET /shell`
  - Renderiza una pagina base del nuevo shell.
- `GET /shell/manifest`
  - Devuelve el manifiesto JSON con capas de cache, grupos de modulos y datos de runtime.
- `GET /api/app-shell/manifest`
  - Alias de manifiesto para consumo desde frontend por AJAX.

Este contrato es la base sobre la que se puede ir migrando el nuevo frontend sin tocar la experiencia actual del monolito de golpe.
