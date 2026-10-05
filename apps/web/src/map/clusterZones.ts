import {
  area,
  bbox,
  booleanValid,
  booleanPointInPolygon,
  centerOfMass,
  distance,
  featureCollection,
  intersect,
  point,
  pointOnFeature,
  polygon,
  squareGrid,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

const CLUSTER_CELL_SIZE_KM = 0.75;
const TARGET_AREA_PER_CLUSTER_KM2 = 50;

export type ParentZone = {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry | null;
};

export type AffectedCluster = {
  id: string;
  name: string;
  parentZoneId: string;
  parentZoneName: string;
  latitude: number;
  longitude: number;
  areaKm2: number | null;
  geometry: GeoJSON.Geometry | null;
};

type PolygonFeature = Feature<Polygon | MultiPolygon>;
type ClusterCandidate = {
  parentZone: ParentZone;
  componentId: string;
  feature: PolygonFeature;
  representative: Feature<GeoJSON.Point>;
  areaKm2: number;
};

type AoiComponent = {
  id: string;
  parentZone: ParentZone;
  representative: Feature<GeoJSON.Point>;
  areaKm2: number;
};

function toPolygonFeatures(geometry: GeoJSON.Geometry): PolygonFeature[] {
  if (geometry.type === "Polygon") return [polygon(geometry.coordinates) as PolygonFeature];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((coordinates) => polygon(coordinates) as PolygonFeature);
  }
  return [];
}

function getRepresentative(feature: PolygonFeature): Feature<GeoJSON.Point> {
  const center = centerOfMass(feature);
  return booleanPointInPolygon(center, feature) ? center : pointOnFeature(feature);
}

export function buildAffectedClusters(
  parentZones: ParentZone[],
  fallback?: { latitude: number; longitude: number } | null,
  maxClusters = 12
): AffectedCluster[] {
  const candidates: ClusterCandidate[] = [];
  const components: AoiComponent[] = [];

  for (const parentZone of parentZones) {
    if (!parentZone.geometry) continue;
    for (const [componentIndex, parentPolygon] of toPolygonFeatures(parentZone.geometry).entries()) {
      if (!booleanValid(parentPolygon)) continue;
      const componentId = `${parentZone.id}:${componentIndex}`;
      const componentAreaKm2 = area(parentPolygon) / 1_000_000;
      const component: AoiComponent = {
        id: componentId,
        parentZone,
        representative: getRepresentative(parentPolygon),
        areaKm2: componentAreaKm2,
      };
      components.push(component);

      const bounds = bbox(parentPolygon);
      const cells = squareGrid(bounds, CLUSTER_CELL_SIZE_KM, { units: "kilometers" });

      for (const cell of cells.features) {
        const child = intersect(featureCollection([cell, parentPolygon]));
        if (!child) continue;
        const childAreaKm2 = area(child) / 1_000_000;
        if (childAreaKm2 < 0.02) continue;
        const feature = child as PolygonFeature;
        candidates.push({
          parentZone,
          componentId,
          feature,
          representative: getRepresentative(feature),
          areaKm2: childAreaKm2,
        });
      }
    }
  }

  if (!candidates.length && fallback && parentZones.length) {
    const { latitude, longitude } = fallback;
    return [{
      id: `${parentZones[0].id}-C1`,
      name: "Cluster 1",
      parentZoneId: parentZones[0].id,
      parentZoneName: parentZones[0].name,
      latitude,
      longitude,
      areaKm2: null,
      geometry: null,
    }];
  }

  const componentIdsWithCandidates = new Set(candidates.map((candidate) => candidate.componentId));
  const routableComponents = components
    .filter((component) => componentIdsWithCandidates.has(component.id))
    .sort((a, b) => b.areaKm2 - a.areaKm2);
  const totalAreaKm2 = routableComponents.reduce((total, component) => total + component.areaKm2, 0);
  const desiredCount = Math.min(
    maxClusters,
    Math.max(
      routableComponents.length,
      Math.ceil(totalAreaKm2 / TARGET_AREA_PER_CLUSTER_KM2),
      1
    )
  );

  const selected: ClusterCandidate[] = [];
  for (const component of routableComponents.slice(0, desiredCount)) {
    const componentCandidates = candidates.filter((candidate) => candidate.componentId === component.id);
    const nearestCenterCell = componentCandidates.reduce((best, candidate) =>
      distance(candidate.representative, component.representative, { units: "kilometers" }) <
      distance(best.representative, component.representative, { units: "kilometers" })
        ? candidate
        : best
    );
    selected.push(nearestCenterCell);
  }

  while (selected.length < Math.min(desiredCount, candidates.length)) {
    const remaining = candidates.filter((candidate) => !selected.includes(candidate));
    if (!remaining.length) break;
    const next = remaining.reduce((best, candidate) => {
      const nearestDistance = (item: ClusterCandidate) => Math.min(
        ...selected.map((chosen) =>
          distance(item.representative, chosen.representative, { units: "kilometers" })
        )
      );
      const score = (item: ClusterCandidate) =>
        nearestDistance(item) + Math.min(item.areaKm2, CLUSTER_CELL_SIZE_KM ** 2) * 0.1;
      return score(candidate) > score(best) ? candidate : best;
    });
    selected.push(next);
  }

  return selected.map((candidate, index) => ({
    id: `${candidate.parentZone.id}-C${index + 1}`,
    name: `Cluster ${index + 1}`,
    parentZoneId: candidate.parentZone.id,
    parentZoneName: candidate.parentZone.name,
    longitude: candidate.representative.geometry.coordinates[0],
    latitude: candidate.representative.geometry.coordinates[1],
    areaKm2: Number(candidate.areaKm2.toFixed(2)),
    geometry: candidate.feature.geometry,
  }));
}
