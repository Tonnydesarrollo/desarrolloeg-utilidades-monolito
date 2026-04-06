import express from 'express';
import { listJobs, runJob } from './services/jobRunner.js';
import { getJobSchedulerStatus } from './services/jobScheduler.js';
import { canRunSingletonServices, getClusterCoordinatorStatus } from '../../services/clusterCoordinator.js';

export const jobsRouter = express.Router();

jobsRouter.get('/', (_req, res) => {
  res.json({
    jobs: listJobs(),
    scheduler: getJobSchedulerStatus(),
  });
});

jobsRouter.post('/:jobId/run', async (req, res) => {
  if (!canRunSingletonServices()) {
    return res.status(409).json({
      ok: false,
      error: 'Este nodo esta en standby. Ejecuta el job en el nodo lider.',
      cluster: getClusterCoordinatorStatus(),
    });
  }

  try {
    const result = await runJob(req.params.jobId);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});
