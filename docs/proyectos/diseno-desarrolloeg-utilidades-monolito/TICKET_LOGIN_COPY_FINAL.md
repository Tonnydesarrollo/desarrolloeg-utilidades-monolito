# Ticket tecnico: Limpieza final de copy en login

**Objetivo**
Eliminar cualquier texto de trabajo, etiqueta interna o nota de boceto en el login final. El usuario solo debe ver copy de marca limpio, breve y consistente.

**Problema**
En el login se colaron frases y etiquetas que parecen notas de diseño o jerarquia interna, por ejemplo:
- `Marca`
- `Presencia institucional`
- `QA`
- `Ruta secundaria`
- `12h`
- `Sesion temporal`
- `Acceso corporativo primero. QA solo cuando se requiere validar tickets o probar cambios.`

Ese texto no debe aparecer como parte visible del diseño final.

**Alcance**
- Revisar el bloque visual del login.
- Sustituir copy de trabajo por copy final de marca.
- Mantener el flujo funcional intacto.
- Mantener el acceso QA, pero con microcopy limpio y corto.

**Texto final esperado**
- Mensaje principal breve y de marca.
- Descripcion institucional corta.
- Texto QA minimo, sin jerga de proceso.
- Ningun label interno o comentario de trabajo visible.

**Reglas**
- No usar palabras de borrador como jerarquia, ruta secundaria, presencia institucional o sesion temporal en el UI final.
- No mostrar textos explicativos largos en el bloque visual izquierdo.
- No convertir el login en una lista de atributos.
- No perder el tono institucional de Desarrollo EG.

**Archivos a revisar**
- `src/modules/home/home.router.js`
- `src/public/ui/portal-shell.css`

**Criterios de aceptacion**
- El login debe leerse como una pieza final de producto.
- No deben verse notas de diseño ni descripciones internas.
- El acceso principal debe seguir siendo claro.
- QA debe seguir existiendo, pero con copy discreto.
- El diseño debe sentirse limpio, institucional y cerrado.

