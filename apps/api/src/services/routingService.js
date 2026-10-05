import { haversineKm } from "../utils/geo.js";

const ROUTING_PROVIDER = (process.env.ROUTING_PROVIDER || "osrm").toLowerCase();
if (!["osrm", "ors"].includes(ROUTING_PROVIDER)) {
  throw new Error("ROUTING_PROVIDER must be either 'osrm' or 'ors'");
}
const OSRM_URL = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const ORS_URL = (process.env.ORS_URL || "https://api.openrouteservice.org").replace(/\/$/, "");
const ORS_API_KEY = process.env.ORS_API_KEY;
const CACHE_TTL_MS = Number(process.env.ROUTE_CACHE_TTL_MS) || 5 * 60 * 1000;
const REQUEST_INTERVAL_MS = Math.max(0, Number(process.env.ROUTING_REQUEST_INTERVAL_MS) || 700);
const configuredCandidates = Number(process.env.MAX_HOSPITAL_ROUTES_PER_CLUSTER);
const MAX_ROUTE_CANDIDATES = Number.isInteger(configuredCandidates)
  ? Math.min(5, Math.max(3, configuredCandidates))
  : 4;
const MAX_ROUTE_SNAP_KM = Number(process.env.MAX_ROUTE_SNAP_KM) || 2;

const cache = new Map();
const pendingRoutes = new Map();
const pendingMatrices = new Map();
let requestStartChain = Promise.resolve();
let nextRequestAt = 0;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

async function scheduleRequest(url, options = {}) {
  let release;
  const reservation = new Promise((resolve) => {
    release = resolve;
  });
  const previousReservation = requestStartChain;
  requestStartChain = reservation;
  await previousReservation;
  const waitMs = Math.max(0, nextRequestAt - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
  release();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { ...options.headers },
    });
    if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function routeCacheKey(from, to) {
  return `${ROUTING_PROVIDER}:route:${from.longitude.toFixed(5)},${from.latitude.toFixed(5)}:${to.longitude.toFixed(5)},${to.latitude.toFixed(5)}`;
}

function routeProviderUnavailable(error) {
  return {
    ok: false,
    engine: ROUTING_PROVIDER,
    source: `${ROUTING_PROVIDER.toUpperCase()} road routing unavailable`,
    distanceKm: null,
    durationMin: null,
    geometry: null,
    directions: [],
    confidence: "unavailable",
    status: "unavailable",
    error: error instanceof Error ? error.message : String(error),
  };
}

export function validateRouteGeometry(from, to, route) {
  const coordinates = route?.geometry?.type === "LineString"
    ? route.geometry.coordinates
    : null;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { valid: false, reason: "Route geometry is missing or is not a LineString" };
  }
  if (coordinates.some((coordinate) =>
    !Array.isArray(coordinate) ||
    coordinate.length < 2 ||
    !Number.isFinite(coordinate[0]) ||
    !Number.isFinite(coordinate[1]) ||
    Math.abs(coordinate[0]) > 180 ||
    Math.abs(coordinate[1]) > 90
  )) {
    return { valid: false, reason: "Route geometry contains invalid coordinates" };
  }
  if (
    !Number.isFinite(route.distanceKm) ||
    route.distanceKm <= 0 ||
    !Number.isFinite(route.durationMin) ||
    route.durationMin <= 0
  ) {
    return { valid: false, reason: "Route distance or duration is missing or invalid" };
  }

  const [startLon, startLat] = coordinates[0];
  const [endLon, endLat] = coordinates.at(-1);
  const startSnapKm = haversineKm(from.latitude, from.longitude, startLat, startLon);
  const endSnapKm = haversineKm(to.latitude, to.longitude, endLat, endLon);
  if (startSnapKm > MAX_ROUTE_SNAP_KM || endSnapKm > MAX_ROUTE_SNAP_KM) {
    return {
      valid: false,
      reason: `Road snap exceeds ${MAX_ROUTE_SNAP_KM} km`,
      startSnapKm: Number(startSnapKm.toFixed(2)),
      endSnapKm: Number(endSnapKm.toFixed(2)),
    };
  }

  const directKm = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
  if (route.distanceKm + 1 < directKm * 0.8) {
    return { valid: false, reason: "Road route distance is implausibly shorter than the direct distance" };
  }
  return {
    valid: true,
    startSnapKm: Number(startSnapKm.toFixed(2)),
    endSnapKm: Number(endSnapKm.toFixed(2)),
  };
}

async function requestOsrmRoute(from, to) {
  const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url = `${OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=false&steps=true`;
  const data = await scheduleRequest(url);
  const route = data.routes?.[0];
  if (!route?.geometry) throw new Error("No drivable road route returned");
  const directions = (route.legs || []).flatMap((leg) =>
    (leg.steps || []).map((step) => {
      const maneuver = step.maneuver || {};
      const instruction = maneuver.type === "depart"
        ? `Depart${step.name ? ` on ${step.name}` : ""}`
        : maneuver.type === "arrive"
          ? "Arrive at the hospital"
          : `${maneuver.modifier ? `${maneuver.modifier} ` : ""}${maneuver.type || "Continue"}${step.name ? ` onto ${step.name}` : ""}`;
      return {
        instruction,
        distanceKm: Number.isFinite(step.distance) ? Number((step.distance / 1000).toFixed(2)) : null,
        durationMin: Number.isFinite(step.duration) ? Math.max(1, Math.round(step.duration / 60)) : null,
      };
    })
  );
  return {
    ok: true,
    engine: "OSRM",
    source: "OpenStreetMap road network via OSRM",
    distanceKm: Number((route.distance / 1000).toFixed(2)),
    durationMin: Math.max(1, Math.round(route.duration / 60)),
    geometry: route.geometry,
    directions,
    confidence: "road-network",
    status: "routed",
  };
}

async function requestOrsRoute(from, to) {
  if (!ORS_API_KEY) throw new Error("ORS_API_KEY is required when ROUTING_PROVIDER=ors");
  const url = `${ORS_URL}/v2/directions/driving-car/geojson`;
  const data = await scheduleRequest(url, {
    method: "POST",
    headers: { Authorization: ORS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      coordinates: [
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
      ],
      instructions: true,
    }),
  });
  const feature = data.features?.[0];
  const summary = feature?.properties?.summary;
  if (!feature?.geometry || !summary) throw new Error("No drivable road route returned");
  const directions = (feature.properties.segments || []).flatMap((segment) =>
    (segment.steps || []).map((step) => ({
      instruction: step.instruction,
      distanceKm: Number.isFinite(step.distance) ? Number((step.distance / 1000).toFixed(2)) : null,
      durationMin: Number.isFinite(step.duration) ? Math.max(1, Math.round(step.duration / 60)) : null,
    }))
  );
  return {
    ok: true,
    engine: "OpenRouteService",
    source: "OpenStreetMap road network via OpenRouteService",
    distanceKm: Number((summary.distance / 1000).toFixed(2)),
    durationMin: Math.max(1, Math.round(summary.duration / 60)),
    geometry: feature.geometry,
    directions,
    confidence: "road-network",
    status: "routed",
  };
}

export async function routeBetween(from, to) {
  const key = routeCacheKey(from, to);
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = pendingRoutes.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      const route = ROUTING_PROVIDER === "ors"
        ? await requestOrsRoute(from, to)
        : await requestOsrmRoute(from, to);
      const validation = validateRouteGeometry(from, to, route);
      if (!validation.valid) {
        const unavailable = routeProviderUnavailable(new Error(validation.reason));
        unavailable.snapDistanceKm = {
          origin: validation.startSnapKm ?? null,
          destination: validation.endSnapKm ?? null,
        };
        return unavailable;
      }
      route.snapDistanceKm = {
        origin: validation.startSnapKm,
        destination: validation.endSnapKm,
      };
      if (route.status === "routed") cacheSet(key, route);
      return route;
    } catch (error) {
      return routeProviderUnavailable(error);
    }
  })();
  pendingRoutes.set(key, request);
  try {
    return await request;
  } finally {
    pendingRoutes.delete(key);
  }
}

export async function routeTable(origins, destinations) {
  if (!origins.length || !destinations.length) return null;
  const key = `${ROUTING_PROVIDER}:matrix:${origins
    .map(({ longitude, latitude }) => `${longitude.toFixed(5)},${latitude.toFixed(5)}`)
    .join(";")}:${destinations
    .map(({ longitude, latitude }) => `${longitude.toFixed(5)},${latitude.toFixed(5)}`)
    .join(";")}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const pending = pendingMatrices.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      let data;
      if (ROUTING_PROVIDER === "ors") {
        if (!ORS_API_KEY) throw new Error("ORS_API_KEY is required when ROUTING_PROVIDER=ors");
        const coordinates = [...origins, ...destinations].map(({ longitude, latitude }) => [longitude, latitude]);
        const url = `${ORS_URL}/v2/matrix/driving-car`;
        data = await scheduleRequest(url, {
          method: "POST",
          headers: { Authorization: ORS_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: coordinates,
            sources: origins.map((_origin, index) => index),
            destinations: destinations.map((_destination, index) => origins.length + index),
            metrics: ["distance", "duration"],
          }),
        });
        if (
          !Array.isArray(data.durations) ||
          !Array.isArray(data.distances) ||
          data.durations.length !== origins.length ||
          data.distances.length !== origins.length ||
          data.durations.some((row) => !Array.isArray(row) || row.length !== destinations.length) ||
          data.distances.some((row) => !Array.isArray(row) || row.length !== destinations.length)
        ) {
          throw new Error("Road matrix dimensions do not match the requested locations");
        }
        const matrix = { durations: data.durations, distances: data.distances };
        cacheSet(key, matrix);
        return matrix;
      }

      const coordinates = [...origins, ...destinations]
        .map(({ longitude, latitude }) => `${longitude},${latitude}`)
        .join(";");
      const sources = origins.map((_origin, index) => index).join(";");
      const destinationIndices = destinations.map((_destination, index) => origins.length + index).join(";");
      const url = `${OSRM_URL}/table/v1/driving/${coordinates}?sources=${sources}&destinations=${destinationIndices}&annotations=duration,distance`;
      data = await scheduleRequest(url);
      if (
        !Array.isArray(data.durations) ||
        !Array.isArray(data.distances) ||
        data.durations.length !== origins.length ||
        data.distances.length !== origins.length ||
        data.durations.some((row) => !Array.isArray(row) || row.length !== destinations.length) ||
        data.distances.some((row) => !Array.isArray(row) || row.length !== destinations.length)
      ) {
        throw new Error("Road matrix dimensions do not match the requested locations");
      }
      const matrix = { durations: data.durations, distances: data.distances };
      cacheSet(key, matrix);
      return matrix;
    } catch (error) {
      return {
        durations: null,
        distances: null,
        error: error instanceof Error ? error.message : "Road-network ranking matrix unavailable",
      };
    }
  })();
  pendingMatrices.set(key, request);
  try {
    return await request;
  } finally {
    pendingMatrices.delete(key);
  }
}

export async function routesToFacilities(origin, facilities) {
  const results = [];
  for (const facility of facilities) {
    const route = await routeBetween(origin, {
      latitude: facility.latitude,
      longitude: facility.longitude,
    });
    results.push({
      facilityId: facility.id,
      name: facility.name,
      geographicKm: facility.distanceKm,
      roadKm: route.distanceKm,
      durationMin: route.durationMin,
      confidence: route.confidence,
      geometry: route.geometry,
      engine: route.engine,
      source: route.source,
      status: route.status,
    });
  }
  return results;
}

export function getRoutingConfig() {
  return {
    provider: ROUTING_PROVIDER,
    cacheTtlMs: CACHE_TTL_MS,
    requestIntervalMs: REQUEST_INTERVAL_MS,
    maxRouteCandidates: MAX_ROUTE_CANDIDATES,
  };
}
