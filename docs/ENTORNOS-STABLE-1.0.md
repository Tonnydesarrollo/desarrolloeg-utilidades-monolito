# Entornos desde stable 1.0

## Produccion: PC B

- Rama de referencia: `main`.
- Punto inmutable: tag Git `stable-1.0`.
- Imagen portal: `desarrolloeg-utilidades-monolito:stable-1.0`.
- Imagen sync: `desarrolloeg-appsheet-local-sync:stable-1.0`.
- La base productiva permanece en `C:\deploy\DESARROLLOEG_UTILIDADES_MONOLITO\data`.
- El watchdog de Windows inicia Docker y recupera los contenedores despues de reiniciar.

No se debe ejecutar el Compose de desarrollo en PC B ni desplegar automaticamente la rama `develop`.

## Desarrollo: PC A

- Rama de trabajo: `develop`.
- Portal: `http://localhost:7001`.
- Salud del sincronizador: `http://localhost:8788/health`.
- Base aislada: `data-dev\desarrolloeg.sqlite`.
- Runtime aislado: `runtime-dev`.
- Configuracion privada: `.env.dev.docker`.
- Compose: `docker-compose.dev.yml`.

El sincronizador consulta AppSheet cada minuto y notifica al portal local cuando cambia la revision. Los bots de AppSheet siguen enviando sus webhooks publicos a PC B; PC A recupera esos mismos cambios mediante auditoria y reconciliacion, sin exponer un segundo webhook productivo.

Los jobs automaticos de Casa Ley, Club Factura, pedidos y WhatsApp estan desactivados en PC A para evitar duplicar procesos externos. Las vistas y operaciones interactivas siguen usando la configuracion de AppSheet del entorno.

## Inicio local

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1
```

Para reiniciar sin reconstruir imagenes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1 -NoBuild
```

## Flujo de versiones

1. Desarrollar y verificar en `develop` sobre PC A.
2. Integrar cambios aprobados a `main`.
3. Crear un nuevo tag de version estable.
4. Desplegar exclusivamente esa version aprobada en PC B.
5. Nunca compartir el archivo SQLite entre PC A y PC B; cada nodo mantiene su propia persistencia.
