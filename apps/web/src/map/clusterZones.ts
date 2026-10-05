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
  feature: PolygonFeature;
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
  maxClusters = 6
): AffectedCluster[] {
  const candidates: ClusterCandidate[] = [];

  for (const parentZone of parentZones) {
    if (!parentZone.geometry) continue;
    for (const parentPolygon of toPolygonFeatures(parentZone.geometry)) {
      if (!booleanValid(parentPolygon)) continue;
      const bounds = bbox(parentPolygon);
      const westEast = distance(point([bounds[0], bounds[1]]), point([bounds[2], bounds[1]]), {
        units: "kilometers",
      });
      const southNorth = distance(point([bounds[0], bounds[1]]), point([bounds[0], bounds[3]]), {
        units: "kilometers",
      });
      const cellSideKm = Math.max(0.5, Math.max(westEast, southNorth) / 4);
      const cells = squareGrid(bounds, cellSideKm, { units: "kilometers" });

      for (const cell of cells.features) {
        const child = intersect(featureCollection([cell, parentPolygon]));
        if (!child) continue;
        const childAreaKm2 = area(child) / 1_000_000;
        if (childAreaKm2 < 0.05) continue;
        const feature = child as PolygonFeature;
        candidates.push({
          parentZone,
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

  const selected: ClusterCandidate[] = [];
  const zonesWithCandidates = Array.from(new Set(candidates.map((candidate) => candidate.parentZone.id)));
  for (const zoneId of zonesWithCandidates.slice(0, maxClusters)) {
    const zoneCandidates = candidates.filter((candidate) => candidate.parentZone.id === zoneId);
    const largest = zoneCandidates.reduce((best, candidate) =>
      candidate.areaKm2 > best.areaKm2 ? candidate : best
    );
    selected.push(largest);
  }

  while (selected.length < Math.min(maxClusters, candidates.length)) {
    const remaining = candidates.filter((candidate) => !selected.includes(candidate));
    if (!remaining.length) break;
    const next = remaining.reduce((best, candidate) => {
      const nearestDistance = (item: ClusterCandidate) =>
        Math.min(
          ...selected.map((chosen) =>
            distance(item.representative, chosen.representative, { units: "kilometers" })
          )
        );
      if (!selected.length) return candidate.areaKm2 > best.areaKm2 ? candidate : best;
      return nearestDistance(candidate) > nearestDistance(best) ? candidate : best;
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
