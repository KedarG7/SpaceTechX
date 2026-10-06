import {
  area,
  bbox,
  booleanPointInPolygon,
  booleanValid,
  booleanWithin,
  centerOfMass,
  feature,
  featureCollection,
  intersect,
  kinks,
  pointOnFeature,
} from "@turf/turf";

const MAX_CLUSTERS = 12;
const MAX_VERTICES = 5000;
const MAX_CLUSTER_AREA_KM2 = Number(process.env.MAX_CLUSTER_AREA_KM2) || 82.47;
const MAX_CLUSTER_DIAMETER_KM = 15;

function coordinateCount(value) {
  if (!Array.isArray(value)) return 0;
  if (
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return 1;
  }
  return value.reduce((total, child) => total + coordinateCount(child), 0);
}

function sourceZones(disaster) {
  const aois = (disaster.aois || [])
    .filter((aoi) => aoi.extentGeoJSON)
    .map((aoi) => ({
      id: `${disaster.code}-AOI-${aoi.number}`,
      name: aoi.name || `Affected area ${aoi.number}`,
      geometry: aoi.extentGeoJSON,
    }));
  const candidates = aois.length
    ? aois
    : disaster.extentGeoJSON
    ? [{ id: disaster.code, name: disaster.name, geometry: disaster.extentGeoJSON }]
    : [];
  return candidates.filter((zone) => {
    if (!["Polygon", "MultiPolygon"].includes(zone.geometry?.type)) return false;
    try {
      const source = feature(zone.geometry);
      return booleanValid(source) && kinks(source).features.length === 0;
    } catch {
      return false;
    }
  });
}

export function validateAffectedClusters(clusters, disaster) {
  if (!Array.isArray(clusters) || clusters.length < 1 || clusters.length > MAX_CLUSTERS) {
    throw new Error(`Provide between 1 and ${MAX_CLUSTERS} affected-area clusters`);
  }
  const zones = new Map(sourceZones(disaster).map((zone) => [zone.id, zone]));
  if (!zones.size) throw new Error("Activation does not contain a valid source AOI polygon");
  const populationEstimate =
    disaster.impact?.populationAffected ?? disaster.impact?.populationEstimated ?? null;
  const totalSourceAreaKm2 = [...zones.values()].reduce(
    (total, zone) => total + area(feature(zone.geometry)) / 1_000_000,
    0
  );
  const ids = new Set();
  const validated = [];

  for (const cluster of clusters) {
    if (typeof cluster?.id !== "string" || !cluster.id.trim() || cluster.id.length > 100) {
      throw new Error("Every cluster must have a unique, non-empty ID");
    }
    if (ids.has(cluster.id)) throw new Error(`Duplicate cluster ID: ${cluster.id}`);
    ids.add(cluster.id);

    const parentZone = zones.get(cluster.parentZoneId);
    if (!parentZone) throw new Error(`Cluster ${cluster.id} does not reference a source AOI`);
    if (
      !cluster.geometry ||
      cluster.geometry.type !== "Polygon" ||
      coordinateCount(cluster.geometry.coordinates) > MAX_VERTICES
    ) {
      throw new Error(`Cluster ${cluster.id} has missing, unsupported, or oversized geometry`);
    }

    const clusterFeature = feature(cluster.geometry);
    const parentFeature = feature(parentZone.geometry);
    if (
      !booleanValid(clusterFeature) ||
      !booleanValid(parentFeature) ||
      kinks(clusterFeature).features.length > 0 ||
      kinks(parentFeature).features.length > 0
    ) {
      throw new Error(`Cluster ${cluster.id} or its source AOI has invalid GeoJSON geometry`);
    }
    const clusterAreaKm2 = area(clusterFeature) / 1_000_000;
    if (
      !Number.isFinite(clusterAreaKm2) ||
      clusterAreaKm2 < 0.005 ||
      clusterAreaKm2 > MAX_CLUSTER_AREA_KM2
    ) {
      throw new Error(
        `Cluster ${cluster.id} area must be between 0.005 and ${MAX_CLUSTER_AREA_KM2} km²`
      );
    }
    if (!booleanWithin(clusterFeature, parentFeature)) {
      const clippedToSource = intersect(
        featureCollection([clusterFeature, parentFeature])
      );
      const insideAreaKm2 = clippedToSource ? area(clippedToSource) / 1_000_000 : 0;
      const outsideAreaKm2 = clusterAreaKm2 - insideAreaKm2;
      if (outsideAreaKm2 > Math.max(0.00001, clusterAreaKm2 * 0.0001)) {
        throw new Error(`Cluster ${cluster.id} extends outside its source AOI`);
      }
    }
    const [west, south, east, north] = bbox(clusterFeature);
    const diagonalKm = Math.hypot(
      (east - west) * 111.32 * Math.cos(((south + north) / 2) * Math.PI / 180),
      (north - south) * 111.32
    );
    if (diagonalKm > MAX_CLUSTER_DIAMETER_KM) {
      throw new Error(`Cluster ${cluster.id} exceeds the ${MAX_CLUSTER_DIAMETER_KM} km operational diameter`);
    }

    const center = centerOfMass(clusterFeature);
    const representative = booleanPointInPolygon(center, clusterFeature)
      ? center
      : pointOnFeature(clusterFeature);
    const [longitude, latitude] = representative.geometry.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`Cluster ${cluster.id} has no valid routing origin`);
    }

    for (const previous of validated) {
      const overlap = intersect(
        featureCollection([
          feature(cluster.geometry),
          feature(previous.geometry),
        ])
      );
      if (overlap && area(overlap) / 1_000_000 > 0.005) {
        throw new Error(`Cluster ${cluster.id} overlaps another cluster`);
      }
    }

    validated.push({
      id: cluster.id,
      name: cluster.name || cluster.id,
      parentZoneId: parentZone.id,
      parentZoneName: parentZone.name,
      latitude,
      longitude,
      areaKm2: Number(clusterAreaKm2.toFixed(3)),
      geometry: cluster.geometry,
      severity: disaster.severity || "unknown",
      severityBasis: disaster.severityBasis || "not supplied",
      populationEstimate:
        Number.isFinite(populationEstimate) && totalSourceAreaKm2 > 0
          ? Math.round(populationEstimate * clusterAreaKm2 / totalSourceAreaKm2)
          : null,
      populationEstimateMethod:
        Number.isFinite(populationEstimate) && totalSourceAreaKm2 > 0
          ? "Low-confidence area-proportional estimate; no cluster-level population surface was supplied"
          : "Unavailable: no source population estimate",
      originMethod: "verified source-AOI geometry representative point",
    });
  }
  return validated;
}
