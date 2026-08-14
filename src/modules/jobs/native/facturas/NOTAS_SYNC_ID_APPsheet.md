# Normalizacion de ID en CFDIS

Para AppSheet, los CFDIs deben enviarse con `id` sin sufijo `.0`.

Ejemplo:

- Local / origen: `1485857.0`
- AppSheet: `1485857`

Regla aplicada en el job:

- al construir el payload para `Add`, `Edit` y `Delete`, el servicio normaliza el key
- si el key termina en `.0`, se elimina ese sufijo
- la verificacion de registros usa el mismo valor normalizado

Esto evita que AppSheet rechace el registro por `Row key field 'id' value is missing` cuando el valor llega como decimal convertido a texto.
