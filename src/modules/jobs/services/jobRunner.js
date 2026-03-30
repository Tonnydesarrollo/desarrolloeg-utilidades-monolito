import { spawn } from 'child_process';
import { jobRegistry } from './jobRegistry.js';
import { syncFacturasNative } from '../native/facturas/syncFacturasNative.js';
import { syncPedidosNative } from '../native/pedidos/syncPedidosNative.js';
import { exportCasaleyAllNative, syncCasaleyNative } from '../native/casaley/syncCasaleyNative.js';

const nativeHandlers = {
  'casaley-export-all': exportCasaleyAllNative,
  'casaley-sync-appsheet': syncCasaleyNative,
  'facturas-appsheet-sync': syncFacturasNative,
  'facturas-native-sync': syncFacturasNative,
  'pedidos-native-sync': syncPedidosNative,
};

function isConfigured(job) {
  if (Array.isArray(job.requiredEnv) && job.requiredEnv.length > 0) {
    return job.requiredEnv.every((envName) => Boolean(process.env[envName]));
  }
  if (job.type === 'native') return true;
  return Boolean(process.env[job.cwdEnv]);
}

export function listJobs() {
  return Object.values(jobRegistry).map((job) => ({
    id: job.id,
    description: job.description,
    type: job.type || 'external',
    cwd: job.cwdEnv ? (process.env[job.cwdEnv] || '') : '',
    configured: isConfigured(job),
  }));
}

export function runJob(jobId) {
  const job = jobRegistry[jobId];
  if (!job) throw new Error(`Job no encontrado: ${jobId}`);

  if (job.type === 'native') {
    const handler = nativeHandlers[jobId];
    if (!handler) throw new Error(`Handler nativo no encontrado: ${jobId}`);
    return Promise.resolve(handler()).then((result) => ({
      jobId,
      code: 0,
      stdout: '',
      stderr: '',
      ok: true,
      result,
      native: true,
    }));
  }

  const cwd = process.env[job.cwdEnv];
  if (!cwd) throw new Error(`Falta configurar ${job.cwdEnv}`);

  return new Promise((resolve) => {
    const child = spawn(job.command, job.args, {
      cwd,
      shell: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      resolve({ jobId, code, stdout, stderr, ok: code === 0, native: false });
    });
  });
}
