import express from 'express';
import { listJobs, runJob } from './services/jobRunner.js';
import { getJobSchedulerStatus } from './services/jobScheduler.js';

export const jobsRouter = express.Router();

jobsRouter.get('/', (_req, res) => {
  res.json({
    jobs: listJobs(),
    scheduler: getJobSchedulerStatus(),
  });
});

jobsRouter.post('/:jobId/run', async (req, res) => {
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
