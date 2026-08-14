export const jobRegistry = {
  'casaley-export-all': {
    id: 'casaley-export-all',
    description: 'Exporta datos de CasaLey dentro del monolito sin subir a AppSheet',
    type: 'native',
    requiredEnv: ['CASALEY_USER', 'CASALEY_PASSWORD'],
  },
  'casaley-sync-appsheet': {
    id: 'casaley-sync-appsheet',
    description: 'Ejecuta la sincronizacion CasaLey -> AppSheet dentro del monolito',
    type: 'native',
    requiredEnv: [
      'CASALEY_USER',
      'CASALEY_PASSWORD',
      'CASALEY_APPSHEET_APP_ID',
      'CASALEY_APPSHEET_API_KEY',
      'CASALEY_TABLA_PAGOS',
      'CASALEY_PAGOS_KEY',
      'CASALEY_TABLA_RELACIONADOS',
      'CASALEY_RELACIONADOS_KEY',
      'CASALEY_TABLA_FACTURAS',
      'CASALEY_FACTURAS_KEY',
    ],
  },
  'pagos-ley': {
    id: 'pagos-ley',
    description: 'Sincroniza solo pagos/cheques de CasaLey dentro del monolito',
    type: 'native',
    requiredEnv: [
      'CASALEY_USER',
      'CASALEY_PASSWORD',
      'CASALEY_APPSHEET_APP_ID',
      'CASALEY_APPSHEET_API_KEY',
      'CASALEY_TABLA_PAGOS',
      'CASALEY_PAGOS_KEY',
    ],
  },
  'cheques-ley': {
    id: 'cheques-ley',
    description: 'Sincroniza solo doctos relacionados de CasaLey dentro del monolito',
    type: 'native',
    requiredEnv: [
      'CASALEY_USER',
      'CASALEY_PASSWORD',
      'CASALEY_APPSHEET_APP_ID',
      'CASALEY_APPSHEET_API_KEY',
      'CASALEY_TABLA_RELACIONADOS',
      'CASALEY_RELACIONADOS_KEY',
    ],
  },
  'facturas-ley': {
    id: 'facturas-ley',
    description: 'Sincroniza solo facturas de CasaLey dentro del monolito',
    type: 'native',
    requiredEnv: [
      'CASALEY_USER',
      'CASALEY_PASSWORD',
      'CASALEY_APPSHEET_APP_ID',
      'CASALEY_APPSHEET_API_KEY',
      'CASALEY_TABLA_FACTURAS',
      'CASALEY_FACTURAS_KEY',
    ],
  },
  'facturas-native-sync': {
    id: 'facturas-native-sync',
    description: 'Actualiza la BD local de facturas y extrae XML desde ClubFactura',
    type: 'native',
    requiredEnv: [
      'FACTURAS_CLUBFACTURA_USER',
      'FACTURAS_CLUBFACTURA_PASSWORD',
      'FACTURAS_CLUBFACTURA_BASE',
    ],
  },
  'pedidos-native-sync': {
    id: 'pedidos-native-sync',
    description: 'Ejecuta la sincronizacion de pedidos/liberaciones dentro del monolito',
    type: 'native',
    requiredEnv: [
      'PEDIDOS_APPSHEET_APP_ID',
      'PEDIDOS_APPSHEET_API_KEY',
    ],
  },
};

export function getJobDefinition(jobId) {
  return jobRegistry[String(jobId || "").trim()] || null;
}

export function getJobRequiredEnv(jobId) {
  return Array.isArray(getJobDefinition(jobId)?.requiredEnv)
    ? [...getJobDefinition(jobId).requiredEnv]
    : [];
}

export function getMissingJobEnv(jobId) {
  return getJobRequiredEnv(jobId).filter((envName) => {
    const value = process.env[envName];
    return value === undefined || value === null || String(value).trim() === "";
  });
}

export function getJobConfigurationState(jobId) {
  const definition = getJobDefinition(jobId);
  const requiredEnv = getJobRequiredEnv(jobId);
  const missingEnv = getMissingJobEnv(jobId);
  return {
    exists: Boolean(definition),
    requiredEnv,
    missingEnv,
    configured: Boolean(definition) && missingEnv.length === 0,
  };
}
