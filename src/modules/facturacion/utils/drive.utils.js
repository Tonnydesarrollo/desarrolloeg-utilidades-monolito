import { google } from "googleapis";
import { obtenerNombreArchivo } from "./path.utils.js";

export function crearDriveClient(auth) {
  return google.drive({ version: "v3", auth });
}

export async function obtenerDriveIdPorNombre(drive, nombreArchivo) {
  if (!nombreArchivo) {
    throw new Error("Nombre de archivo requerido");
  }

  const res = await drive.files.list({
    q: `name='${nombreArchivo}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1
  });

  if (!res.data.files || res.data.files.length === 0) {
    throw new Error(`Archivo no encontrado en Drive: ${nombreArchivo}`);
  }

  return res.data.files[0].id;
}

export async function construirThumbnailDesdeLogoPath(drive, logoPath) {
  if (!logoPath) return null;

  const nombreArchivo = obtenerNombreArchivo(logoPath);
  const fileId = await obtenerDriveIdPorNombre(drive, nombreArchivo);
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
}
