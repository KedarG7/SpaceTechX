import test from "node:test";
import assert from "node:assert/strict";
import { area, booleanPointInPolygon, feature, point } from "@turf/turf";
import { buildAffectedClusters, densityClusterPoints } from "./clusterZones.ts";
import { DEMO_INCIDENTS } from "../../../api/src/data/demoIncidents.js";
import { validateAffectedClusters } from "../../../api/src/services/clusterValidation.js";

const sourceGeometry = {
  type: "Polygon",
  coordinates: [[
    [82.7, 22.4],
    [82.9, 22.4],
    [82.9, 22.6],
    [82.7, 22.6],
    [82.7, 22.4],
  ]],
};
const parentZones = [{ id: "test-AOI-1", name: "Observed test AOI", geometry: sourceGeometry }];

test("AOI clusters are small, valid, and constrained to each source boundary", () => {
  const clusters = buildAffectedClusters(parentZones, { latitude: 22.5, longitude: 82.8 }, 12);
  assert.ok(clusters.length > 1 && clusters.length <= 12);
  for (const cluster of clusters) {
    assert.ok(cluster.areaKm2 > 0 && cluster.areaKm2 <= 0.57);
    assert.ok(booleanPointInPolygon(point([cluster.longitude, cluster.latitude]), feature(cluster.geometry)));
    assert.ok(area(feature(cluster.geometry)) > 0);
  }
  assert.equal(new Set(clusters.map((cluster) => cluster.id)).size, clusters.length);
});

test("DBSCAN separates point-dense impact zones and leaves noise out", () => {
  const points = [
    { id: "a1", latitude: 22.5, longitude: 82.8, severity: "moderate", population: 4 },
    { id: "a2", latitude: 22.5003, longitude: 82.8002, severity: "moderate", population: 5 },
    { id: "a3", latitude: 22.5005, longitude: 82.8004, severity: "moderate", population: 6 },
    { id: "b1", latitude: 22.52, longitude: 82.82, severity: "critical", population: 7 },
    { id: "b2", latitude: 22.5202, longitude: 82.8202, severity: "critical", population: 8 },
    { id: "b3", latitude: 22.5204, longitude: 82.8201, severity: "critical", population: 9 },
    { id: "noise", latitude: 22.55, longitude: 82.85, severity: "low", population: 1 },
  ];
  const clusters = densityClusterPoints(points, { radiusKm: 0.75, minimumAffectedPoints: 3 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters.flat().some(({ id }) => id === "noise"), false);

  const impactClusters = buildAffectedClusters(parentZones, null, 12, {
    radiusKm: 0.75,
    minimumAffectedPoints: 3,
    impactPoints: points,
  });
  assert.equal(impactClusters.length, 2);
  assert.equal(impactClusters[0].severity, "critical");
  assert.equal(impactClusters[0].populationEstimate, 24);
});

test("cluster density settings are validated", () => {
  assert.throws(
    () => densityClusterPoints([], { radiusKm: 0, minimumAffectedPoints: 0 }),
    /must be positive/
  );
});

test("generated AOI cells pass backend source-boundary validation across demo incidents", () => {
  const counts = [];
  for (const incident of DEMO_INCIDENTS) {
    const zones = incident.aois.map((aoi) => ({
      id: `${incident.code}-AOI-${aoi.number}`,
      name: aoi.name,
      geometry: aoi.extentGeoJSON,
    }));
    const clientClusters = buildAffectedClusters(zones, incident.centroid, 12, {
      incidentSeverity: incident.severity,
    });
    const verified = validateAffectedClusters(clientClusters, {
      ...incident,
      severityBasis: "demonstration-data",
    });
    assert.ok(verified.length > 0, incident.code);
    assert.ok(verified.every((cluster) => cluster.areaKm2 <= 0.75), incident.code);
    assert.ok(verified.every((cluster) => cluster.originMethod.includes("source-AOI")), incident.code);
    counts.push(verified.length);
  }
  assert.ok(new Set(counts).size > 1);
});
