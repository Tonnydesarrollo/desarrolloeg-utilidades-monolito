import os from "os";
import { startBackgroundServices, stopBackgroundServices } from "./backgroundServices.js";

const DEFAULT_PUBLIC_HEALTH_URL =
  String(process.env.APP_ENVIRONMENT || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase() === "qa"
    ? "https://qa.apps.desarrolloeg.com/health"
    : "https://apps.desarrolloeg.com/health";

const clusterState = {
  started: false,
  enabled: false,
  role: "standalone",
  strategy: "single-node",
  instanceId: "",
  publicHealthUrl: DEFAULT_PUBLIC_HEALTH_URL,
  checkIntervalMs: 15000,
  healthTimeoutMs: 5000,
  missThreshold: 3,
  promotionBaseDelayMs: 5000,
  promotionJitterMs: 12000,
  effectivePromotionDelayMs: 5000,
  consecutiveLeaderMisses: 0,
  lastCheckAt: null,
  lastLeaderSeenAt: null,
  lastPromotedAt: null,
  lastDecision: "pending",
  lastProbe: null,
  nextPromotionAt: null,
  conflictingLeaderDetected: false,
  timer: null,
  promotionTimer: null,
};

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stableHash(text) {
  let hash = 0;
  for (const char of String(text || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function resolveInstanceId() {
  const candidate =
    process.env.CLUSTER_INSTANCE_ID ||
    process.env.COMPUTERNAME ||
    process.env.HOSTNAME ||
    os.hostname();

  return String(candidate || "node")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "node";
}

function getClusterConfig() {
  const enabled = parseBoolean(process.env.CLUSTER_ENABLED, false);
  const instanceId = resolveInstanceId();
  const promotionBaseDelayMs = parseNonNegativeNumber(process.env.CLUSTER_PROMOTION_DELAY_MS, 5000);
  const promotionJitterMs = parseNonNegativeNumber(process.env.CLUSTER_PROMOTION_JITTER_MS, 12000);
  const effectivePromotionDelayMs = promotionBaseDelayMs + (stableHash(instanceId) % (promotionJitterMs + 1));

  return {
    enabled,
    instanceId,
    publicHealthUrl: String(process.env.CLUSTER_PUBLIC_HEALTH_URL || DEFAULT_PUBLIC_HEALTH_URL).trim(),
    checkIntervalMs: parsePositiveNumber(process.env.CLUSTER_CHECK_INTERVAL_MS, 15000),
    healthTimeoutMs: parsePositiveNumber(process.env.CLUSTER_HEALTH_TIMEOUT_MS, 5000),
    missThreshold: parsePositiveNumber(process.env.CLUSTER_MISS_THRESHOLD, 3),
    promotionBaseDelayMs,
    promotionJitterMs,
    effectivePromotionDelayMs,
  };
}

function applyClusterConfig(config) {
  clusterState.enabled = config.enabled;
  clusterState.instanceId = config.instanceId;
  clusterState.publicHealthUrl = config.publicHealthUrl;
  clusterState.checkIntervalMs = config.checkIntervalMs;
  clusterState.healthTimeoutMs = config.healthTimeoutMs;
  clusterState.missThreshold = config.missThreshold;
  clusterState.promotionBaseDelayMs = config.promotionBaseDelayMs;
  clusterState.promotionJitterMs = config.promotionJitterMs;
  clusterState.effectivePromotionDelayMs = config.effectivePromotionDelayMs;
  clusterState.strategy = config.enabled ? "public-health-gated-standby" : "single-node";
}

function clearPromotionTimer() {
  clearTimeout(clusterState.promotionTimer);
  clusterState.promotionTimer = null;
  clusterState.nextPromotionAt = null;
}

function buildProbeUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("_clusterProbe", Date.now().toString());
  return url.toString();
}

async function probePublicHealth(config) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.healthTimeoutMs);

  try {
    const response = await fetch(buildProbeUrl(config.publicHealthUrl), {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    clearTimeout(timeout);

    const cluster = payload?.cluster || null;
    const observedRole = cluster?.role || (payload?.background?.started ? "leader" : "standby");
    const observedInstanceId = cluster?.instanceId || null;
    const leaderPresent =
      response.ok &&
      ((cluster?.enabled && observedRole === "leader") || (!cluster?.enabled && Boolean(payload?.background?.started)));

    return {
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      leaderPresent,
      observedRole,
      observedInstanceId,
      payload,
      error: null,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      httpStatus: 0,
      latencyMs: Date.now() - startedAt,
      leaderPresent: false,
      observedRole: null,
      observedInstanceId: null,
      payload: null,
      error: error instanceof Error ? error.message : "No se pudo consultar health publico",
    };
  }
}

function noteLeaderSeen(probe) {
  clusterState.consecutiveLeaderMisses = 0;
  clusterState.lastLeaderSeenAt = new Date().toISOString();
  clusterState.lastDecision =
    probe.observedInstanceId && probe.observedInstanceId !== clusterState.instanceId
      ? `leader_detected:${probe.observedInstanceId}`
      : "leader_confirmed";
  clearPromotionTimer();
}

function schedulePromotion(reason) {
  if (clusterState.role === "leader" || clusterState.promotionTimer) return;

  clusterState.lastDecision = reason;
  clusterState.nextPromotionAt = new Date(Date.now() + clusterState.effectivePromotionDelayMs).toISOString();
  clusterState.promotionTimer = setTimeout(() => {
    clusterState.promotionTimer = null;
    clusterState.nextPromotionAt = null;

    if (clusterState.role === "leader") return;
    if (clusterState.consecutiveLeaderMisses < clusterState.missThreshold) return;

    clusterState.role = "leader";
    clusterState.lastPromotedAt = new Date().toISOString();
    clusterState.lastDecision = "promoted_to_leader";
    console.log(`[cluster] lider activo en ${clusterState.instanceId}`);
    startBackgroundServices();
  }, clusterState.effectivePromotionDelayMs);
}

function noteLeaderMiss(probe) {
  clusterState.consecutiveLeaderMisses += 1;
  clusterState.lastDecision = probe.ok ? "leader_not_present" : "leader_health_unreachable";

  if (clusterState.consecutiveLeaderMisses >= clusterState.missThreshold) {
    schedulePromotion(clusterState.lastDecision);
  }
}

function shouldDemoteForObservedLeader(observedInstanceId) {
  const observed = String(observedInstanceId || "").trim();
  const current = String(clusterState.instanceId || "").trim();
  if (!observed || !current || observed === current) return false;
  return observed.localeCompare(current, "en", { sensitivity: "base" }) < 0;
}

function demoteToStandby(observedInstanceId) {
  if (clusterState.role !== "leader") return;
  clusterState.role = "standby";
  clusterState.lastDecision = `demoted_for_leader:${observedInstanceId}`;
  clusterState.conflictingLeaderDetected = false;
  clearPromotionTimer();
  console.warn(
    `[cluster] ${clusterState.instanceId} vuelve a standby; lider preferido detectado: ${observedInstanceId}`
  );
  void stopBackgroundServices().catch((error) => {
    console.error(
      "[cluster] no se pudieron detener servicios al volver a standby:",
      error instanceof Error ? error.message : error
    );
  });
}

async function runClusterCheck() {
  const config = getClusterConfig();
  applyClusterConfig(config);
  const probe = await probePublicHealth(config);

  clusterState.lastCheckAt = new Date().toISOString();
  clusterState.lastProbe = {
    ok: probe.ok,
    httpStatus: probe.httpStatus,
    latencyMs: probe.latencyMs,
    leaderPresent: probe.leaderPresent,
    observedRole: probe.observedRole,
    observedInstanceId: probe.observedInstanceId,
    error: probe.error,
  };

  if (clusterState.role === "leader") {
    clusterState.consecutiveLeaderMisses = 0;
    clusterState.nextPromotionAt = null;
    clusterState.conflictingLeaderDetected =
      Boolean(probe.leaderPresent) &&
      Boolean(probe.observedInstanceId) &&
      probe.observedInstanceId !== clusterState.instanceId;

    if (clusterState.conflictingLeaderDetected) {
      clusterState.lastDecision = `leader_conflict:${probe.observedInstanceId}`;
      console.warn(
        `[cluster] se detecto otro lider publico (${probe.observedInstanceId}) mientras ${clusterState.instanceId} sigue activo`
      );
      if (shouldDemoteForObservedLeader(probe.observedInstanceId)) {
        demoteToStandby(probe.observedInstanceId);
      }
    }
    return;
  }

  clusterState.conflictingLeaderDetected = false;

  if (probe.leaderPresent) {
    noteLeaderSeen(probe);
    return;
  }

  noteLeaderMiss(probe);
}

export function startClusterCoordinator() {
  if (clusterState.started) return;
  clusterState.started = true;

  const config = getClusterConfig();
  applyClusterConfig(config);

  if (!config.enabled) {
    clusterState.role = "standalone";
    clusterState.lastDecision = "cluster_disabled";
    startBackgroundServices();
    return;
  }

  clusterState.role = "standby";
  clusterState.lastDecision = "waiting_for_public_leader";
  console.log(
    `[cluster] coordinacion activa en ${config.instanceId}; observando ${config.publicHealthUrl} antes de promover servicios`
  );

  void runClusterCheck();
  clusterState.timer = setInterval(() => {
    void runClusterCheck();
  }, config.checkIntervalMs);
}

export function getClusterCoordinatorStatus() {
  return {
    enabled: clusterState.enabled,
    strategy: clusterState.strategy,
    instanceId: clusterState.instanceId,
    role: clusterState.role,
    publicHealthUrl: clusterState.publicHealthUrl,
    started: clusterState.started,
    checkIntervalMs: clusterState.checkIntervalMs,
    healthTimeoutMs: clusterState.healthTimeoutMs,
    missThreshold: clusterState.missThreshold,
    promotionBaseDelayMs: clusterState.promotionBaseDelayMs,
    promotionJitterMs: clusterState.promotionJitterMs,
    effectivePromotionDelayMs: clusterState.effectivePromotionDelayMs,
    consecutiveLeaderMisses: clusterState.consecutiveLeaderMisses,
    lastCheckAt: clusterState.lastCheckAt,
    lastLeaderSeenAt: clusterState.lastLeaderSeenAt,
    lastPromotedAt: clusterState.lastPromotedAt,
    lastDecision: clusterState.lastDecision,
    lastProbe: clusterState.lastProbe,
    nextPromotionAt: clusterState.nextPromotionAt,
    conflictingLeaderDetected: clusterState.conflictingLeaderDetected,
    canRunSingletons: !clusterState.enabled || clusterState.role === "leader" || clusterState.role === "standalone",
  };
}

export function canRunSingletonServices() {
  return !clusterState.enabled || clusterState.role === "leader" || clusterState.role === "standalone";
}
