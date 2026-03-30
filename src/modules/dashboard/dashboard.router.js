import express from "express";
import { env } from "../../config/env.js";
import { getDashboardData, renderDashboardHtml } from "./dashboard.service.js";

export const dashboardRouter = express.Router();

function getBaseUrl(req) {
  const host = req.get("host") || `localhost:${env.port}`;
  return `${req.protocol}://${host}`;
}

dashboardRouter.get("/status.json", async (req, res) => {
  const data = await getDashboardData(getBaseUrl(req));
  res.json(data);
});

dashboardRouter.get("/", async (req, res) => {
  const data = await getDashboardData(getBaseUrl(req));
  res.type("html").send(renderDashboardHtml(data));
});
