# Cotizaciones: altas desde AppSheet y plataforma

La plataforma crea directamente todos los registros de
`CONCEPTOS_VARIOS_CT`, sin esperar al bot de AppSheet y sin agregar columnas a
la tabla de cotizaciones.

## Configuracion en AppSheet

En el evento del bot que crea los conceptos, usar esta condicion:

```appsheet
ISNOTBLANK([CONCEPTOS])
```

Las altas hechas en AppSheet siempre llevan los conceptos seleccionados y
ejecutan el bot. Las altas desde la plataforma dejan `CONCEPTOS` vacio en la
cabecera y crean inmediatamente todos los hijos mediante la API. El documento
de cotizacion obtiene sus centros y conceptos desde esas filas relacionadas.
