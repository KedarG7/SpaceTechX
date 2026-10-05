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
import { validateAffectedClusters } from "../services/clusterValidation.js";
import {
  assignDistinctRecommendations,
  rankHospitalCandidates,
  routeScoringWeights,
} from "../services/hospitalRanking.js";
import { haversineKm } from "../utils/geo.js";

export const api = Router();

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
}

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
    const payload = await listDisasters({
      mode,
      country: req.query.country || "india",
      refresh: req.query.refresh === "1",
    });
    recordAudit({ action: "list_disasters", detail: { mode, count: payload.items.length } });
    res.json(payload);
  } catch (error) {
    console.error("Unable to fetch disaster data", error);
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
  } catch (error) {
    console.error(`Unable to fetch activation detail ${req.params.id}`, error);
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
  } catch (error) {
    console.error(`Unable to fetch affected area ${req.params.id}`, error);
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
  } catch (error) {
    console.error(`Unable to query hospitals for ${req.params.id}`, error);
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
  } catch (error) {
    console.error(`Unable to query facilities for ${req.params.id}`, error);
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
  } catch (error) {
    console.error(`Unable to compute routes for ${req.params.id}`, error);
    res.status(500).json({ error: "Unable to compute routes" });
  }
});

api.post("/disasters/:id/cluster-routes", async (req, res) => {
  let disaster;
  try {
    disaster = await getDisaster(req.params.id);
    if (!disaster) return res.status(404).json({ error: "Activation not found" });
  } catch (error) {
    console.error("Unable to load activation for cluster routing", error);
    return res.status(500).json({ error: "Unable to load activation for cluster routing" });
  }

  let clusters;
  try {
    clusters = validateAffectedClusters(req.body?.clusters, disaster);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid affected-area clusters" });
  }
  const clusterConfig = req.body?.clusterConfig || {};
  const clusterRadiusKm = Number(clusterConfig.radiusKm ?? 0.75);
  const minimumAffectedPoints = Number(clusterConfig.minimumAffectedPoints ?? 3);
  const requestedMaxClusters = Number(clusterConfig.maxClusters ?? clusters.length);
  if (
    !Number.isFinite(clusterRadiusKm) ||
    clusterRadiusKm <= 0 ||
    clusterRadiusKm > 20 ||
    !Number.isInteger(minimumAffectedPoints) ||
    minimumAffectedPoints < 1 ||
    minimumAffectedPoints > 100 ||
    !Number.isInteger(requestedMaxClusters) ||
    requestedMaxClusters < 1 ||
    requestedMaxClusters > 12
  ) {
    return res.status(400).json({ error: "Cluster radius, minimum points, or maximum cluster count is outside its allowed range" });
  }

  try {
    const maxRouteCandidates = getRoutingConfig().maxRouteCandidates;
    const candidatesByCluster = await Promise.all(
      clusters.map(async (cluster) => {
        const hospitals = await nearestHospitals(cluster.latitude, cluster.longitude, {
          limit: 20,
          radiusKm: 250,
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
      matrix?.durations?.some((row, rowIndex) =>
        row?.some((duration, columnIndex) =>
          Number.isFinite(duration) &&
          duration > 0 &&
          Number.isFinite(matrix?.distances?.[rowIndex]?.[columnIndex]) &&
          matrix.distances[rowIndex][columnIndex] > 0
        )
      )
    );
    const hospitalIndex = new Map(uniqueHospitals.map((hospital, index) => [hospital.id, index]));

    const candidatesWithMatrix = candidatesByCluster.map(({ cluster, hospitals }, clusterIndex) => {
      const roadCandidates = hospitals.map((hospital) => {
            const destinationIndex = hospitalIndex.get(hospital.id);
            const durationSeconds = destinationIndex == null ? null : matrix?.durations?.[clusterIndex]?.[destinationIndex];
            const distanceMeters = destinationIndex == null ? null : matrix?.distances?.[clusterIndex]?.[destinationIndex];
            const roadKm = Number.isFinite(distanceMeters) ? Number((distanceMeters / 1000).toFixed(2)) : null;
            const durationMin = Number.isFinite(durationSeconds) ? Math.round(durationSeconds / 60) : null;
            return {
              hospital,
              roadKm,
              durationMin,
              routeReachable: roadKm != null && durationMin != null && roadKm > 0 && durationMin > 0,
              geographicKm: haversineKm(cluster.latitude, cluster.longitude, hospital.latitude, hospital.longitude),
            };
          });
      const ranked = rankHospitalCandidates(
        roadCandidates.filter((candidate) => candidate.routeReachable),
        { severity: cluster.severity }
      );
      return { cluster, hospitals, roadCandidates, ranked };
    });
    const initialAssignments = assignDistinctRecommendations(
      candidatesWithMatrix.map(({ cluster, ranked }) => ({ ...cluster, candidates: ranked }))
    );

    const routeResults = await Promise.all(
      candidatesWithMatrix.map(async ({ cluster, hospitals, roadCandidates, ranked }) => {
        const candidateLimit = Math.max(maxRouteCandidates + 1, 5);
        const candidateIds = new Set(ranked.slice(0, candidateLimit).map(({ hospital }) => hospital.id));
        for (const hospital of hospitals.slice(0, candidateLimit)) {
          if (candidateIds.size >= candidateLimit) break;
          candidateIds.add(hospital.id);
        }
        const initiallyAssignedId = initialAssignments.get(cluster.id);
        if (initiallyAssignedId) candidateIds.add(initiallyAssignedId);
        const selectedCandidates = hospitals
          .filter((hospital) => candidateIds.has(hospital.id))
          .map((hospital) => ({
            hospital,
            matrixCandidate: roadCandidates.find((candidate) => candidate.hospital.id === hospital.id),
          }));
        const rejected = [];
        const routed = await Promise.all(
          selectedCandidates.map(async ({ hospital, matrixCandidate }) => {
            const route = await routeBetween(cluster, {
              latitude: hospital.latitude,
              longitude: hospital.longitude,
            });
            if (route.status !== "routed" || !route.geometry) {
              rejected.push({
                hospitalId: hospital.id,
                hospitalName: hospital.name,
                reason: route.error || "Router returned no validated road geometry",
              });
              return null;
            }
            return {
              hospital,
              roadKm: route.distanceKm,
              durationMin: route.durationMin,
              geographicKm: matrixCandidate?.geographicKm ??
                haversineKm(cluster.latitude, cluster.longitude, hospital.latitude, hospital.longitude),
              routeGeometry: route.geometry,
              routeDirections: route.directions,
              routeSource: route.source,
              routeEngine: route.engine,
              routeSnapDistanceKm: route.snapDistanceKm,
              routeReachable: true,
            };
          })
        );
        const scored = rankHospitalCandidates(
          routed.filter(Boolean),
          { severity: cluster.severity }
        );
        return {
          cluster,
          candidates: scored,
          rejectedCandidates: rejected,
          candidateScores: scored.map((candidate) => ({
            hospitalId: candidate.hospital.id,
            hospitalName: candidate.hospital.name,
            roadKm: candidate.roadKm,
            durationMin: candidate.durationMin,
            score: candidate.score,
            scoreBreakdown: candidate.scoreBreakdown,
          })),
          matrixCandidateCount: roadCandidates.filter((candidate) => candidate.routeReachable).length,
        };
      })
    );
    const assignments = assignDistinctRecommendations(routeResults);
    const routedClusters = routeResults.map(({ cluster, candidates, rejectedCandidates, candidateScores, matrixCandidateCount }) => {
      const assignedHospitalId = assignments.get(cluster.id) || null;
      const ordered = [...candidates].sort((left, right) => {
        if (left.hospital.id === assignedHospitalId) return -1;
        if (right.hospital.id === assignedHospitalId) return 1;
        return left.score - right.score;
      }).slice(0, maxRouteCandidates);
      const hospitalRoutes = ordered.map((candidate, index) => ({
        id: `${cluster.id}:${candidate.hospital.id}`,
        rank: index + 1,
        routeType: candidate.hospital.id === assignedHospitalId ? "recommended" : "alternative",
        hospital: {
          ...candidate.hospital,
          roadKm: candidate.roadKm,
          durationMin: candidate.durationMin,
          routeGeometry: candidate.routeGeometry,
          routeConfidence: "road-network",
          routeSource: candidate.routeSource,
        },
        roadKm: candidate.roadKm,
        durationMin: candidate.durationMin,
        estimatedTravelTime: true,
        liveTraffic: false,
        routeStatus: "routed",
        routeConfidence: "road-network",
        routeSource: candidate.routeSource,
        routeGeometry: candidate.routeGeometry,
        routeDirections: candidate.routeDirections,
        routeSnapDistanceKm: candidate.routeSnapDistanceKm,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        scoreWeights: candidate.scoreWeights,
        rankingBasis: "Validated OSRM/OpenRouteService route geometry, estimated road travel time/distance, and published emergency listing. Live traffic, closures, and hospital availability are not supplied.",
        selectionReason: candidate.hospital.id === assignedHospitalId
          ? "Proposed distinct hospital for this incident's severity-prioritized cluster; hospital capacity/availability is unverified."
          : `Road route ranks ${candidate.score.toFixed(2)} on normalized route criteria; capacity/availability is unverified.`,
      }));
      return {
        ...cluster,
        hospitalRoutes,
        assignedHospitalId,
        assignmentStatus: assignedHospitalId ? "proposed_unverified_availability" : "unresolved",
        routingStatus: hospitalRoutes.length ? "routed" : "unresolved",
        routingFailure: hospitalRoutes.length ? null : rejectedCandidates[0]?.reason || "No connected road route passed validation",
        matrixCandidateCount,
        ...(req.body?.debug
          ? {
              debug: {
                clusterConfig: {
                  radiusKm: clusterRadiusKm,
                  minimumAffectedPoints,
                  maxClusters: requestedMaxClusters,
                },
                clusterOriginMethod: cluster.originMethod,
                pointObservationStatus: "Copernicus activation detail does not currently provide a point-level affected-population/damage feed; source AOI footprints are used.",
                roadMatrixCandidateCount: matrixCandidateCount,
                candidateScores,
                rejectedCandidates,
                attemptedCandidateCount: rejectedCandidates.length + candidateScores.length,
              },
            }
          : {}),
      };
    });
    const routedCount = routedClusters.reduce((sum, cluster) => sum + cluster.hospitalRoutes.length, 0);
    recordAudit({
      action: "cluster_routes_requested",
      incident: disaster.code,
      dataSources: ["Government of India National Hospital Directory", "OSRM/OpenStreetMap"],
      detail: { clusterCount: clusters.length, routeCount: routedCount },
    });
    res.json({
      incident: disaster.code,
      parentZone: {
        id: disaster.code,
        name: disaster.name,
        geometry: disaster.extentGeoJSON || null,
        areaKm2: disaster.affectedAreaKm2 ?? null,
      },
      generatedAt: new Date().toISOString(),
      routingProvider: getRoutingConfig(),
      scoreWeights: routeScoringWeights(),
      rankingBasis: "All returned assignments require a validated road route and are scored on route time/distance, listed emergency capability, and availability confidence. No straight-line fallback is used.",
      capacityAvailability: "Live hospital capacity/occupancy and operational status are unavailable; all assignments are proposals, not confirmed dispatches.",
      routeTimeBasis: "Estimated from the road network; live traffic is not included.",
      hospitalSourceQuality: "Compiled Government of India directory seed; facility coordinates/listings and operational status require field verification.",
      routeMatrixStatus: hasRoadNetworkMetrics ? "road-network" : "unavailable",
      routeMatrixError: matrix?.error || null,
      clusterParameters: {
        radiusKm: clusterRadiusKm,
        minimumAffectedPoints,
        maxClusters: requestedMaxClusters,
        pointDensityClusteringUsed: false,
        pointDensityReason: "No point-level affected-area observations are present in the Copernicus activation detail response.",
      },
      totalRoutedAlternatives: routedCount,
      unresolvedClusterCount: routedClusters.filter((cluster) => !cluster.hospitalRoutes.length).length,
      clusters: routedClusters,
    });
  } catch (error) {
    console.error(`Unable to compute cluster routes for ${disaster.code}`, error);
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
  } catch (error) {
    console.error(`Unable to generate sitrep for ${req.params.id}`, error);
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
  } catch (error) {
    console.error(`Assistant request failed for ${req.params.id}`, error);
    res.status(500).json({ error: "Assistant unavailable" });
  }
});

api.get("/hospitals", async (req, res) => {
  if (req.query.lat && req.query.lng) {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    if (!validCoordinate(latitude, longitude)) {
      return res.status(400).json({ error: "Latitude and longitude must be valid WGS84 coordinates" });
    }
    try {
      const rows = await nearestHospitals(latitude, longitude, {
        limit: Math.min(20, Math.max(1, Number(req.query.limit) || 10)),
        radiusKm: Math.min(250, Math.max(1, Number(req.query.radiusKm) || 50)),
      });
      return res.json({ hospitals: rows });
    } catch (error) {
      console.error("Unable to query hospital directory", error);
      return res.status(500).json({ error: "Unable to query hospital directory" });
    }
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
  let target;
  try {
    target = new URL(String(req.query.url || ""));
    if (!ALLOWED_GEOJSON_HOSTS.has(target.host)) {
      return res.status(400).json({ error: "Host not allow-listed" });
    }
  } catch (error) {
    console.warn("Rejected malformed GeoJSON layer URL", error);
    return res.status(400).json({ error: "Invalid layer URL" });
  }
  try {
    const response = await fetch(target);
    if (!response.ok) return res.status(502).json({ error: "Upstream layer failed" });
    const json = await response.json();
    res.json(json);
  } catch (error) {
    console.error("Upstream GeoJSON layer request failed", error);
    res.status(502).json({ error: "Unable to fetch upstream layer" });
  }
});

api.post("/route", async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: "from and to required" });
  if (!validCoordinate(Number(from.latitude), Number(from.longitude)) ||
      !validCoordinate(Number(to.latitude), Number(to.longitude))) {
    return res.status(400).json({ error: "Route coordinates must be valid WGS84 latitude/longitude pairs" });
  }
  try {
    res.json(await routeBetween(
      { latitude: Number(from.latitude), longitude: Number(from.longitude) },
      { latitude: Number(to.latitude), longitude: Number(to.longitude) }
    ));
  } catch (error) {
    console.error("Unexpected route request failure", error);
    res.status(500).json({ error: "Unable to compute route" });
  }
});
