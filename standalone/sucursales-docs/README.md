# Generador Independiente de Documentos con Membrete

Este generador vive aparte de las rutas y modulos actuales del monolito.

Sirve para:

- Consultar la tabla `SUCURSALES` en AppSheet.
- Elegir una sucursal por `ID`, `TIENDA` o texto.
- Rellenar una plantilla HTML con placeholders de la fila.
- Exportar el resultado a `HTML` y `PDF`.

## Archivos

- `generate.js`: script principal.
- `config/branding.default.json`: datos del membrete.
- `templates/membrete-eg.html`: plantilla base del documento.
- `templates/cuerpo-base.html`: cuerpo de ejemplo editable.

## Uso rapido

Listar sucursales:

```powershell
node standalone/sucursales-docs/generate.js --list
```

Generar por numero de tienda:

```powershell
node standalone/sucursales-docs/generate.js --tienda 1012
```

Generar por ID:

```powershell
node standalone/sucursales-docs/generate.js --id ABC123
```

Generar por texto:

```powershell
node standalone/sucursales-docs/generate.js --query "Culiacan"
```

Usar otro cuerpo de documento:

```powershell
node standalone/sucursales-docs/generate.js --tienda 1012 --body mi-plantilla.html --title "OFICIO"
```

Solo HTML:

```powershell
node standalone/sucursales-docs/generate.js --tienda 1012 --format html
```

## Placeholders

Puedes usar placeholders dentro del cuerpo o de la plantilla principal:

- `{{LABEL2}}`
- `{{TIENDA}}`
- `{{ID}}`
- `{{document_title}}`
- `{{document_subtitle}}`
- `{{generated_date}}`
- `{{generated_datetime}}`

Tambien se crean aliases normalizados para columnas con espacios o acentos.

Ejemplo:

- columna `Row ID` -> `{{ROW_ID}}`
- columna `Fecha Vencimiento` -> `{{FECHA_VENCIMIENTO}}`

Para insertar HTML sin escapar, usa triples llaves:

- `{{{body_html}}}`
- `{{{footer_left_html}}}`
- `{{{footer_right_html}}}`
- `{{{all_fields_rows}}}`

## Personalizacion

1. Edita `templates/cuerpo-base.html` o crea otro archivo HTML.
2. Si necesitas cambiar logo, nombre o telefonos, edita `config/branding.default.json`.
3. Si quieres otro archivo de branding, usa:

```powershell
node standalone/sucursales-docs/generate.js --tienda 1012 --branding .\mi-branding.json
```

## Variables de entorno

El script intenta reutilizar la configuracion existente del proyecto, en este orden:

- `DOCS_APPSHEET_APP_ID`
- `WHATSAPP_CAP_APPSHEET_APP_ID`
- `CONSTANCIAS_APPSHEET_APP_ID`
- `PLANEACION_APPSHEET_APP_ID`
- `APPSHEET_APP_ID`

Y para la llave:

- `DOCS_APPSHEET_ACCESS_KEY`
- `WHATSAPP_CAP_APPSHEET_ACCESS_KEY`
- `CONSTANCIAS_APPSHEET_API_KEY`
- `PLANEACION_APPSHEET_API_KEY`
- `APPSHEET_API_KEY`

La tabla por defecto es:

- `DOCS_TABLE_SUCURSALES`
- `WHATSAPP_CAP_TABLE_SUCURSALES`
- valor final: `SUCURSALES`

## Notas

- El PDF usa `puppeteer-core`, por lo que necesita una ruta valida de Chrome.
- El logo por defecto apunta a `..\img\logo.png` respecto al repo.
- Esta base esta pensada para documentos tipo oficio, constancia, carta o formatos de una pagina. Si luego quieres repeticion exacta del membrete en varias paginas, lo podemos extender sobre esta misma base.
