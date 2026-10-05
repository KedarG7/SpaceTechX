import { Router } from "express";
import {
  ALLOWED_GEOJSON_HOSTS,
  copernicusFreshness,
  getDisaster,
  listDisasters,
} from "../services/copernicusService.js";
import {
  allHospitals,
  hospitalStats,
  isPostgisEnabled,
  nearestFacilities,
  nearestHospitals,
} from "../database/geoStore.js";
import {
  getRoutingConfig,
  routeBetween,
  routeTable,
  routesToFacilities,
} from "../services/routingService.js";
import { listAudit, recordAudit } from "../services/auditService.js";
import { answerOperator, generateSitrep } from "../services/intelligenceService.js";

export const api = Router();

function originOf(disaster) {
  if (!disaster?.centroid) return null;
  return disaster.centroid;
}

api.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ndrf-disaster-intelligence-api",
    postgis: isPostgisEnabled(),
    time: new Date().toISOString(),
  });
});

api.get("/disasters", async (req, res) => {
  try {
    const mode = req.query.mode || "india";
    const payload = await listDisasters({ mode, country: req.query.country || "india" });
    recordAudit({ action: "list_disasters", detail: { mode, count: payload.items.length } });
    res.json(payload);
  } catch {
    res.status(500).json({ error: "Unable to fetch disaster data" });
  }
});

api.get("/disasters/:id", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
    recordAudit({
      action: "view_incident",
      incident: disaster.code,
      dataSources: [disaster.source],
    });
    res.json(disaster);
  } catch {
    res.status(500).json({ error: "Unable to fetch activation detail" });
  }
});

api.get("/disasters/:id/area", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
    res.json({
      code: disaster.code,
      centroid: disaster.centroid,
      affectedAreaKm2: disaster.affectedAreaKm2,
      extentGeoJSON: disaster.extentGeoJSON,
      aois: disaster.aois?.map((a) => ({
        name: a.name,
        number: a.number,
        extentGeoJSON: a.extentGeoJSON,
      })),
      layers: disaster.layers || [],
      source: disaster.source,
    });
  } catch {
    res.status(500).json({ error: "Unable to fetch affected area" });
  }
});

api.get("/disasters/:id/hospitals", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster?.centroid) return res.status(404).json({ error: "Activation or centroid missing" });
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const radiusKm = Number(req.query.radiusKm) || 80;
    const origin = originOf(disaster);
    const hospitals = await nearestHospitals(origin.latitude, origin.longitude, { limit, radiusKm });
    let withRoutes = hospitals;
    if (req.query.route !== "0") {
      const routed = await routesToFacilities(origin, hospitals);
      const byId = Object.fromEntries(routed.map((r) => [r.facilityId, r]));
      withRoutes = hospitals.map((h) => ({
        ...h,
        roadKm: byId[h.id]?.roadKm,
        durationMin: byId[h.id]?.durationMin,
        routeConfidence: byId[h.id]?.confidence,
        routeGeometry: byId[h.id]?.geometry,
        routeSource: byId[h.id]?.source,
      }));
    }
    recordAudit({
      action: "hospital_query",
      incident: disaster.code,
      dataSources: ["Government of India National Hospital Directory", "OSRM/OpenStreetMap"],
    });
    res.json({
      incident: disaster.code,
      origin,
      engine: isPostgisEnabled() ? "postgis" : "haversine",
      hospitals: withRoutes,
    });
  } catch {
    res.status(500).json({ error: "Unable to query hospitals" });
  }
});

api.get("/disasters/:id/facilities", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster?.centroid) return res.status(404).json({ error: "Activation or centroid missing" });
    const origin = originOf(disaster);
    const facilities = await nearestFacilities(origin.latitude, origin.longitude);
    res.json({ incident: disaster.code, origin, facilities });
  } catch {
    res.status(500).json({ error: "Unable to query facilities" });
  }
});

api.get("/disasters/:id/routes", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster?.centroid) return res.status(404).json({ error: "Activation or centroid missing" });
    const hospitals = await nearestHospitals(disaster.centroid.latitude, disaster.centroid.longitude, {
      limit: Number(req.query.limit) || 5,
    });
    const targetId = req.query.facilityId;
    const targets = targetId ? hospitals.filter((h) => h.id === targetId) : hospitals;
    const routes = await routesToFacilities(disaster.centroid, targets);
    recordAudit({
      action: "route_requested",
      incident: disaster.code,
      dataSources: ["OSRM", "OpenStreetMap"],
      detail: { facilityId: targetId || "top-hospitals" },
    });
    res.json({ incident: disaster.code, routes });
  } catch {
    res.status(500).json({ error: "Unable to compute routes" });
  }
});

api.post("/disasters/:id/cluster-routes", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
    const clusters = req.body?.clusters;
    if (
      !Array.isArray(clusters) ||
      clusters.length < 1 ||
      clusters.length > 8 ||
      clusters.some(
        (cluster) =>
          typeof cluster?.id !== "string" ||
          !Number.isFinite(cluster.latitude) ||
          !Number.isFinite(cluster.longitude) ||
          Math.abs(cluster.latitude) > 90 ||
          Math.abs(cluster.longitude) > 180 ||
          typeof cluster.parentZoneId !== "string"
      )
    ) {
      return res.status(400).json({ error: "Provide 1–8 affected-area clusters with valid coordinates and parent zones" });
    }

    const candidatesByCluster = await Promise.all(
      clusters.map(async (cluster) => {
        const hospitals = await nearestHospitals(cluster.latitude, cluster.longitude, {
          limit: 6,
          radiusKm: 120,
        });
        return { cluster, hospitals };
      })
    );
    const hospitalById = new Map();
    candidatesByCluster.forEach(({ hospitals }) => {
      hospitals.forEach((hospital) => hospitalById.set(hospital.id, hospital));
    });
    const uniqueHospitals = [...hospitalById.values()];
    const matrix = await routeTable(
      clusters.map(({ latitude, longitude }) => ({ latitude, longitude })),
      uniqueHospitals
    );
    const hasRoadNetworkMetrics = Boolean(
      matrix?.durations?.some((row) => row?.some((duration) => Number.isFinite(duration))) ||
        matrix?.distances?.some((row) => row?.some((distance) => Number.isFinite(distance)))
    );
    const hospitalIndex = new Map(uniqueHospitals.map((hospital, index) => [hospital.id, index]));

    const routedClusters = await Promise.all(
      candidatesByCluster.map(async ({ cluster, hospitals }, clusterIndex) => {
        const rankedUnsorted = hospitals
          .map((hospital) => {
            const destinationIndex = hospitalIndex.get(hospital.id);
            const durationSeconds = destinationIndex == null ? null : matrix?.durations?.[clusterIndex]?.[destinationIndex];
            const distanceMeters = destinationIndex == null ? null : matrix?.distances?.[clusterIndex]?.[destinationIndex];
            const roadKm = Number.isFinite(distanceMeters) ? Number((distanceMeters / 1000).toFixed(2)) : null;
            const durationMin = Number.isFinite(durationSeconds) ? Math.round(durationSeconds / 60) : null;
            return { hospital, roadKm, durationMin };
          });
        const maxRoadKm = Math.max(1, ...rankedUnsorted.map((entry) => entry.roadKm || entry.hospital.distanceKm));
        const maxDurationMin = Math.max(1, ...rankedUnsorted.map((entry) => entry.durationMin || entry.hospital.distanceKm * 2));
        const maxGeographicKm = Math.max(1, ...rankedUnsorted.map((entry) => entry.hospital.distanceKm));
        const ranked = rankedUnsorted
          .map((entry) => {
            const durationScore = entry.durationMin != null
              ? (entry.durationMin / maxDurationMin) * 70
              : (entry.hospital.distanceKm / maxGeographicKm) * 70;
            const distanceScore = entry.roadKm != null
              ? (entry.roadKm / maxRoadKm) * 30
              : (entry.hospital.distanceKm / maxGeographicKm) * 30;
            const emergencyPenalty = entry.hospital.emergency ? 0 : 25;
            const directoryBedTieBreaker = Math.min(0.5, (entry.hospital.beds || 0) / 4000);
            return {
              ...entry,
              accessibilityCost: durationScore + distanceScore + emergencyPenalty - directoryBedTieBreaker,
            };
          })
          .sort((left, right) => left.accessibilityCost - right.accessibilityCost);

        const selected = [];
        for (const candidate of ranked) {
          if (selected.length >= getRoutingConfig().maxRouteCandidates) break;
          const bearing = (hospital) =>
            (Math.atan2(
              Math.sin(((hospital.longitude - cluster.longitude) * Math.PI) / 180) *
                Math.cos((hospital.latitude * Math.PI) / 180),
              Math.cos((cluster.latitude * Math.PI) / 180) *
                Math.sin((hospital.latitude * Math.PI) / 180) -
                Math.sin((cluster.latitude * Math.PI) / 180) *
                  Math.cos((hospital.latitude * Math.PI) / 180) *
                  Math.cos(((hospital.longitude - cluster.longitude) * Math.PI) / 180)
            ) *
              180) /
            Math.PI;
          if (
            selected.length === 0 ||
            selected.every((other) => Math.abs(((bearing(candidate.hospital) - bearing(other.hospital) + 540) % 360) - 180) >= 12)
          ) {
            selected.push(candidate);
          }
        }
        for (const candidate of ranked) {
          if (selected.length >= Math.min(2, getRoutingConfig().maxRouteCandidates)) break;
          if (!selected.some((entry) => entry.hospital.id === candidate.hospital.id)) selected.push(candidate);
        }

        const hospitalRoutes = await Promise.all(
          selected.map(async (candidate, index) => {
            const route = await routeBetween(cluster, {
              latitude: candidate.hospital.latitude,
              longitude: candidate.hospital.longitude,
            });
            return {
              id: `${cluster.id}:${candidate.hospital.id}`,
              rank: index + 1,
              routeType: index === 0 ? "recommended" : "alternative",
              hospital: candidate.hospital,
              roadKm: route.distanceKm ?? candidate.roadKm,
              durationMin: route.durationMin ?? candidate.durationMin,
              routeStatus: route.status,
              routeConfidence: route.confidence,
              routeSource: route.source,
              routeGeometry: route.geometry,
              routeDirections: route.directions || [],
              rankingBasis: candidate.durationMin != null || candidate.roadKm != null
                ? "Road-network distance and travel time, with emergency capability; static directory bed count is only a tie-breaker."
                : "Geographic distance and emergency capability only; road-network ranking is unavailable.",
              selectionReason: [
                candidate.durationMin != null ? `Road ETA ${candidate.durationMin} min` : null,
                candidate.roadKm != null ? `road distance ${candidate.roadKm} km` : `geographic distance ${candidate.hospital.distanceKm} km`,
                candidate.hospital.emergency ? "emergency-capable listing" : "emergency capability not verified",
                candidate.hospital.beds != null ? `${candidate.hospital.beds} directory beds (not live capacity)` : "capacity data unavailable",
              ].filter(Boolean).join(" · "),
            };
          })
        );

        return { ...cluster, hospitalRoutes };
      })
    );
    recordAudit({
      action: "cluster_routes_requested",
      incident: disaster.code,
      dataSources: ["Government of India National Hospital Directory", "OSRM/OpenStreetMap"],
      detail: { clusterCount: clusters.length, routeCount: routedClusters.reduce((sum, cluster) => sum + cluster.hospitalRoutes.length, 0) },
    });
    res.json({
      incident: disaster.code,
      parentZone: {
        id: disaster.code,
        name: disaster.name,
        geometry: disaster.extentGeoJSON || null,
        areaKm2: disaster.affectedAreaKm2 ?? null,
      },
      severity: disaster.severity,
      confidenceScore: req.body?.confidenceScore ?? null,
      generatedAt: new Date().toISOString(),
      routingProvider: getRoutingConfig(),
      rankingBasis: hasRoadNetworkMetrics
        ? "Road distance and estimated travel time, prioritizing listed emergency capability. Directory bed counts are static and are not live availability."
        : "Road-network matrix unavailable; hospitals are ranked by geographic accessibility and listed emergency capability.",
      capacityAvailability: "Live hospital capacity/occupancy is unavailable in the source directory.",
      routeMatrixStatus: hasRoadNetworkMetrics ? "road-network" : "geographic-fallback",
      routeMatrixError: matrix?.error || null,
      clusters: routedClusters,
    });
  } catch {
    res.status(500).json({ error: "Unable to compute cluster routes" });
  }
});

api.post("/disasters/:id/sitrep", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
    const origin = disaster.centroid;
    const hospitals = origin
      ? await nearestHospitals(origin.latitude, origin.longitude, { limit: 5 })
      : [];
    const routed = origin ? await routesToFacilities(origin, hospitals) : [];
    const byId = Object.fromEntries(routed.map((r) => [r.facilityId, r]));
    const hospitalRows = hospitals.map((h) => ({ ...h, ...byId[h.id] }));
    const facilities = origin
      ? await nearestFacilities(origin.latitude, origin.longitude)
      : [];
    const text = generateSitrep(disaster, hospitalRows, facilities);
    recordAudit({
      action: "sitrep_generated",
      incident: disaster.code,
      dataSources: [disaster.source, "GoI Hospital Directory", "OSM/OSRM"],
    });
    res.json({ incident: disaster.code, generatedAt: new Date().toISOString(), text });
  } catch {
    res.status(500).json({ error: "Unable to generate sitrep" });
  }
});

api.post("/disasters/:id/assistant", async (req, res) => {
  try {
    const disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
    const origin = disaster.centroid;
    const hospitals = origin
      ? await nearestHospitals(origin.latitude, origin.longitude, { limit: 12, radiusKm: 120 })
      : [];
    const routed = origin ? await routesToFacilities(origin, hospitals.slice(0, 5)) : [];
    const byId = Object.fromEntries(routed.map((r) => [r.facilityId, r]));
    const hospitalRows = hospitals.map((h) => ({ ...h, ...byId[h.id] }));
    const facilities = origin
      ? await nearestFacilities(origin.latitude, origin.longitude)
      : [];
    const answer = answerOperator(req.body?.message || "", {
      disaster,
      hospitals: hospitalRows,
      facilities,
      routes: routed,
    });
    recordAudit({
      action: "assistant_query",
      incident: disaster.code,
      detail: { message: req.body?.message },
      dataSources: answer.sources,
    });
    res.json(answer);
  } catch {
    res.status(500).json({ error: "Assistant unavailable" });
  }
});

api.get("/hospitals", async (req, res) => {
  if (req.query.lat && req.query.lng) {
    const rows = await nearestHospitals(Number(req.query.lat), Number(req.query.lng), {
      limit: Number(req.query.limit) || 10,
      radiusKm: Number(req.query.radiusKm) || 50,
    });
    return res.json({ hospitals: rows });
  }
  res.json({ hospitals: allHospitals() });
});

api.get("/statistics", async (_req, res) => {
  const listed = await listDisasters({ mode: "india" });
  const counts = { critical: 0, high: 0, moderate: 0 };
  for (const item of listed.items) {
    counts[item.severity] = (counts[item.severity] || 0) + 1;
  }
  res.json({
    incidents: listed.items.length,
    liveIndiaCount: listed.liveIndiaCount,
    severity: counts,
    hospitals: hospitalStats(),
    postgis: isPostgisEnabled(),
    copernicus: copernicusFreshness(),
    notice: listed.notice,
  });
});

api.get("/freshness", (_req, res) => {
  res.json({
    copernicus: copernicusFreshness(),
    hospitals: { source: "GoI National Hospital Directory (compiled)", updated: "2025-06-01", tier: "stale" },
    roads: { source: "OpenStreetMap / OSRM", updated: "2026-09-30", tier: "recent" },
    facilities: { source: "OSM + NDRF public locations (compiled)", updated: "2026-09-30", tier: "recent" },
  });
});

api.get("/audit", (_req, res) => {
  res.json({ events: listAudit() });
});

api.post("/audit", (req, res) => {
  res.json(recordAudit(req.body || {}));
});

api.get("/layers/geojson", async (req, res) => {
  try {
    const target = new URL(String(req.query.url || ""));
    if (!ALLOWED_GEOJSON_HOSTS.has(target.host)) {
      return res.status(400).json({ error: "Host not allow-listed" });
    }
    const response = await fetch(target);
    if (!response.ok) return res.status(502).json({ error: "Upstream layer failed" });
    const json = await response.json();
    res.json(json);
  } catch {
    res.status(400).json({ error: "Invalid layer URL" });
  }
});

api.post("/route", async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: "from and to required" });
  res.json(await routeBetween(from, to));
});
