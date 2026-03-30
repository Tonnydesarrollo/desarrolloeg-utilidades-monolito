/**
 * Extrae el nombre del archivo desde un path tipo AppSheet
 * Ej: "Empresas_Images/9.Logo.164538.png"
 */
export function obtenerNombreArchivo(path) {
  if (!path) return null;
  return path.split("/").pop();
}
