import {
  area,
  bbox,
  booleanValid,
  booleanPointInPolygon,
  circle,
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

const OPERATIONAL_CLUSTER_RADIUS_KM = 5;
const MAX_CLUSTER_AREA_KM2 = Math.PI * OPERATIONAL_CLUSTER_RADIUS_KM ** 2 * 1.05;
const MAX_SAMPLES_PER_COMPONENT = 120;
const MAX_POLYGON_COMPONENTS = 32;

export type ImpactPoint = {
  id?: string;
  latitude: number;
  longitude: number;
  severity?: string;
  population?: number | null;
};

export type ClusterConfig = {
  radiusKm?: number;
  minimumAffectedPoints?: number;
  maxClusters?: number;
  impactPoints?: ImpactPoint[];
  incidentSeverity?: string;
};

function impactPointHull(features: Feature<GeoJSON.Point>[]) {
  const coordinates = [...new Map(
    features.map(({ geometry }) => {
      const [longitude, latitude] = geometry.coordinates;
      return [`${longitude}:${latitude}`, [longitude, latitude] as [number, number]];
    })
  ).values()].sort(([leftLon, leftLat], [rightLon, rightLat]) =>
    leftLon - rightLon || leftLat - rightLat
  );
  if (coordinates.length < 3) return null;
  const cross = (
    origin: [number, number],
    left: [number, number],
    right: [number, number]
  ) =>
    (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0]);
  const lower: [number, number][] = [];
  for (const coordinate of coordinates) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, coordinate) <= 0) {
      lower.pop();
    }
    lower.push(coordinate);
  }
  const upper: [number, number][] = [];
  for (const coordinate of [...coordinates].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, coordinate) <= 0) {
      upper.pop();
    }
    upper.push(coordinate);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;
  hull.push([...hull[0]]);
  return polygon([hull]);
}

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
  severity?: string;
  severityPriority?: number;
  populationEstimate?: number | null;
};

function pointBucketKey(pointFeature: Feature<GeoJSON.Point>, latitudeStep: number, longitudeStep: number) {
  const [longitude, latitude] = pointFeature.geometry.coordinates;
  return `${Math.floor((latitude + 90) / latitudeStep)}:${Math.floor((longitude + 180) / longitudeStep)}`;
}

function severityRank(value = "") {
  if (typeof value === "number") return Math.min(4, Math.max(0, value));
  return ({ critical: 4, high: 3, moderate: 2, low: 1 })[value.toLowerCase()] || 0;
}

function severityLabel(rank: number) {
  if (rank >= 3.5) return "critical";
  if (rank >= 2.5) return "high";
  if (rank >= 1.5) return "moderate";
  if (rank >= 0.5) return "low";
  return "unknown";
}

export function densityClusterPoints(
  impactPoints: ImpactPoint[],
  { radiusKm = 5, minimumAffectedPoints = 3 }: Pick<ClusterConfig, "radiusKm" | "minimumAffectedPoints"> = {}
) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || !Number.isInteger(minimumAffectedPoints) || minimumAffectedPoints < 1) {
    throw new Error("DBSCAN radius and minimum affected-point count must be positive");
  }
  const points = impactPoints
    .filter((item) =>
      Number.isFinite(item.latitude) &&
      Number.isFinite(item.longitude) &&
      Math.abs(item.latitude) <= 90 &&
      Math.abs(item.longitude) <= 180
    )
    .map((item) => ({
      source: item,
      feature: point([item.longitude, item.latitude]),
    }));
  if (!points.length) return [];

  const maxLatitude = Math.max(...points.map(({ source }) => Math.abs(source.latitude)));
  const latitudeStep = radiusKm / 111.32;
  const longitudeStep = radiusKm / (111.32 * Math.max(0.05, Math.cos((maxLatitude * Math.PI) / 180)));
  const buckets = new Map<string, number[]>();
  points.forEach((item, index) => {
    const key = pointBucketKey(item.feature, latitudeStep, longitudeStep);
    buckets.set(key, [...(buckets.get(key) || []), index]);
  });
  const neighbors = (index: number) => {
    const [longitude, latitude] = points[index].feature.geometry.coordinates;
    const row = Math.floor((latitude + 90) / latitudeStep);
    const column = Math.floor((longitude + 180) / longitudeStep);
    const matches: number[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        for (const candidate of buckets.get(`${row + rowOffset}:${column + columnOffset}`) || []) {
          if (distance(points[index].feature, points[candidate].feature, { units: "kilometers" }) <= radiusKm) {
            matches.push(candidate);
          }
        }
      }
    }
    return matches;
  };

  const noise = -1;
  const unvisited = -2;
  const labels = points.map(() => unvisited);
  let nextClusterId = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (labels[index] !== unvisited) continue;
    const nearby = neighbors(index);
    if (nearby.length < minimumAffectedPoints) {
      labels[index] = noise;
      continue;
    }
    const clusterId = nextClusterId++;
    labels[index] = clusterId;
    const queue = [...nearby];
    const queued = new Set(queue);
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const candidate = queue[queueIndex];
      if (labels[candidate] === noise) labels[candidate] = clusterId;
      if (labels[candidate] !== unvisited) continue;
      labels[candidate] = clusterId;
      const candidateNeighbors = neighbors(candidate);
      if (candidateNeighbors.length < minimumAffectedPoints) continue;
      for (const neighbor of candidateNeighbors) {
        if (!queued.has(neighbor)) {
          queue.push(neighbor);
          queued.add(neighbor);
        }
      }
    }
  }

  return Array.from({ length: nextClusterId }, (_unused, clusterId) =>
    points.filter((_item, index) => labels[index] === clusterId).map(({ source }) => source)
  );
}

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
  maxClusters = 12,
  config: ClusterConfig = {}
): AffectedCluster[] {
  const configuredMaxClusters = Math.min(12, Math.max(1, config.maxClusters || maxClusters));
  const operationalRadiusKm = Math.min(
    OPERATIONAL_CLUSTER_RADIUS_KM,
    config.radiusKm || OPERATIONAL_CLUSTER_RADIUS_KM
  );
  const targetAreaPerClusterKm2 = Math.PI * operationalRadiusKm ** 2;
  if (config.impactPoints?.length) {
    const pointCandidates: ClusterCandidate[] = [];
    const assignedSourcePoints = new Set<string>();
    for (const parentZone of parentZones) {
      if (!parentZone.geometry) continue;
      const parentFeatures = toPolygonFeatures(parentZone.geometry).filter(booleanValid);
      const zonePoints = config.impactPoints.filter((item) => {
        const pointFeature = point([item.longitude, item.latitude]);
        const key = `${item.longitude}:${item.latitude}`;
        const contained = parentFeatures.some((parentFeature) =>
          booleanPointInPolygon(pointFeature, parentFeature)
        );
        if (!contained || assignedSourcePoints.has(key)) return false;
        assignedSourcePoints.add(key);
        return true;
      });
      const densityGroups = densityClusterPoints(zonePoints, {
        radiusKm: config.radiusKm,
        minimumAffectedPoints: config.minimumAffectedPoints,
      });
      for (const group of densityGroups) {
        const features = group.map((item) => point([item.longitude, item.latitude]));
        const hull = impactPointHull(features);
        if (!hull) continue;
        const groupCenter = getRepresentative(hull);
        const clusterFootprint = circle(groupCenter, operationalRadiusKm, { units: "kilometers", steps: 24 });
        const clipped = parentFeatures
          .map((parentFeature) => intersect(featureCollection([clusterFootprint, parentFeature])))
          .filter((item): item is PolygonFeature => Boolean(item));
        if (!clipped.length) continue;
        for (const feature of clipped.flatMap((item) => toPolygonFeatures(item.geometry))) {
          const areaKm2 = area(feature) / 1_000_000;
          if (areaKm2 < 0.01 || areaKm2 > MAX_CLUSTER_AREA_KM2) continue;
          pointCandidates.push({
            parentZone,
            componentId: `${parentZone.id}:observed-points`,
            feature,
            representative: getRepresentative(feature),
            areaKm2,
            severity: severityLabel(Math.max(...group.map((item) => severityRank(item.severity)))),
            severityPriority: Math.max(...group.map((item) => severityRank(item.severity))),
            populationEstimate: group.every((item) => Number.isFinite(item.population))
              ? group.reduce((total, item) => total + (item.population || 0), 0)
              : null,
          });
        }
      }
    }
    pointCandidates.sort((a, b) =>
      (b.severityPriority || 0) - (a.severityPriority || 0) ||
      b.areaKm2 - a.areaKm2
    );
    const nonOverlapping: ClusterCandidate[] = [];
    for (const candidate of pointCandidates) {
      const overlaps = nonOverlapping.some((chosen) => {
        const overlap = intersect(featureCollection([candidate.feature, chosen.feature]));
        return Boolean(overlap) && area(overlap) / 1_000_000 > 0.005;
      });
      if (!overlaps) nonOverlapping.push(candidate);
    }
    return nonOverlapping.slice(0, configuredMaxClusters).map((candidate, index) => ({
      id: `${candidate.parentZone.id}-D${index + 1}`,
      name: `Density cluster ${index + 1}`,
      parentZoneId: candidate.parentZone.id,
      parentZoneName: candidate.parentZone.name,
      longitude: candidate.representative.geometry.coordinates[0],
      latitude: candidate.representative.geometry.coordinates[1],
      areaKm2: Number(candidate.areaKm2.toFixed(3)),
      geometry: candidate.feature.geometry,
      severity: candidate.severity === "unknown" ? config.incidentSeverity : candidate.severity,
      populationEstimate: candidate.populationEstimate,
    }));
  }

  const candidates: ClusterCandidate[] = [];
  const components: AoiComponent[] = [];
  let sampleBudget = 1000;

  for (const parentZone of parentZones) {
    if (!parentZone.geometry) continue;
    for (const [componentIndex, parentPolygon] of toPolygonFeatures(parentZone.geometry)
      .slice(0, MAX_POLYGON_COMPONENTS)
      .entries()) {
      if (sampleBudget <= 0) break;
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
      const latitudeScaleKm = 111.32;
      const longitudeScaleKm = latitudeScaleKm * Math.max(
        0.05,
        Math.cos(((bounds[1] + bounds[3]) / 2) * Math.PI / 180)
      );
      const boundingAreaKm2 =
        (bounds[2] - bounds[0]) * longitudeScaleKm *
        (bounds[3] - bounds[1]) * latitudeScaleKm;
      const sampleSpacingKm = Math.max(
        operationalRadiusKm,
        Math.sqrt(Math.max(componentAreaKm2, boundingAreaKm2) / MAX_SAMPLES_PER_COMPONENT)
      );
      const samples = squareGrid(bounds, sampleSpacingKm, { units: "kilometers" });

      for (const sample of samples.features) {
        if (sampleBudget-- <= 0) break;
        const sampleArea = intersect(featureCollection([sample, parentPolygon]));
        if (!sampleArea || area(sampleArea) < 50_000) continue;
        const sampleCenter = getRepresentative(sampleArea as PolygonFeature);
        const localCircle = circle(sampleCenter, operationalRadiusKm, {
          units: "kilometers",
          steps: 12,
        });
        const child = intersect(featureCollection([localCircle, parentPolygon]));
        if (!child) continue;
        for (const feature of toPolygonFeatures(child.geometry)) {
          const childAreaKm2 = area(feature) / 1_000_000;
          if (childAreaKm2 < 0.01 || childAreaKm2 > MAX_CLUSTER_AREA_KM2) continue;
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
  }

  if (!candidates.length && parentZones.length) {
    for (const parentZone of parentZones) {
      if (!parentZone.geometry) continue;
      for (const parentFeature of toPolygonFeatures(parentZone.geometry).filter(booleanValid)) {
        const center = fallback
          ? point([fallback.longitude, fallback.latitude])
          : getRepresentative(parentFeature);
        const footprint = circle(center, operationalRadiusKm, { units: "kilometers", steps: 24 });
        const clipped = intersect(featureCollection([footprint, parentFeature]));
        if (!clipped) continue;
        const candidate = toPolygonFeatures(clipped.geometry)
          .map((feature) => ({ feature, areaKm2: area(feature) / 1_000_000 }))
          .find((item) => item.areaKm2 >= 0.005 && item.areaKm2 <= MAX_CLUSTER_AREA_KM2);
        if (!candidate) continue;
        const representative = getRepresentative(candidate.feature);
        return [{
          id: `${parentZone.id}-C1`,
          name: "Cluster 1",
          parentZoneId: parentZone.id,
          parentZoneName: parentZone.name,
          longitude: representative.geometry.coordinates[0],
          latitude: representative.geometry.coordinates[1],
          areaKm2: Number(candidate.areaKm2.toFixed(2)),
          geometry: candidate.feature.geometry,
        }];
      }
    }
  }

  const componentIdsWithCandidates = new Set(candidates.map((candidate) => candidate.componentId));
  const routableComponents = components
    .filter((component) => componentIdsWithCandidates.has(component.id))
    .sort((a, b) => b.areaKm2 - a.areaKm2);
  const totalAreaKm2 = routableComponents.reduce((total, component) => total + component.areaKm2, 0);
  const desiredCount = Math.min(
    configuredMaxClusters,
    Math.max(
      routableComponents.length,
      Math.ceil(totalAreaKm2 / targetAreaPerClusterKm2),
      1
    )
  );

  const selected: ClusterCandidate[] = [];
  for (const component of routableComponents.slice(0, desiredCount)) {
    const componentCandidates = candidates.filter((candidate) => candidate.componentId === component.id);
    const startsAtEdge = component.areaKm2 < targetAreaPerClusterKm2 * 3;
    const seed = componentCandidates.reduce((best, candidate) => {
      const candidateDistance = distance(candidate.representative, component.representative, { units: "kilometers" });
      const bestDistance = distance(best.representative, component.representative, { units: "kilometers" });
      return startsAtEdge
        ? candidateDistance > bestDistance ? candidate : best
        : candidateDistance < bestDistance ? candidate : best;
    });
    selected.push(seed);
  }

  while (selected.length < Math.min(desiredCount, candidates.length)) {
    const remaining = candidates.filter((candidate) =>
      !selected.includes(candidate) &&
      !selected.some((chosen) => {
        const overlap = intersect(featureCollection([candidate.feature, chosen.feature]));
        return Boolean(overlap) && area(overlap) / 1_000_000 > 0.005;
      })
    );
    if (!remaining.length) break;
    const next = remaining.reduce((best, candidate) => {
      const nearestDistance = (item: ClusterCandidate) => Math.min(
        ...selected.map((chosen) =>
          distance(item.representative, chosen.representative, { units: "kilometers" })
        )
      );
      const score = (item: ClusterCandidate) =>
        nearestDistance(item) + Math.min(item.areaKm2, MAX_CLUSTER_AREA_KM2) * 0.1;
      return score(candidate) > score(best) ? candidate : best;
    });
    selected.push(next);
  }

  const nonOverlapping = [];
  for (const candidate of selected) {
    const duplicatesExisting = nonOverlapping.some((chosen) => {
      const overlap = intersect(featureCollection([
        candidate.feature,
        chosen.feature,
      ]));
      return Boolean(overlap) && area(overlap) / 1_000_000 > 0.005;
    });
    if (!duplicatesExisting) nonOverlapping.push(candidate);
  }

  return nonOverlapping.map((candidate, index) => ({
    id: `${candidate.parentZone.id}-C${index + 1}`,
    name: `Cluster ${index + 1}`,
    parentZoneId: candidate.parentZone.id,
    parentZoneName: candidate.parentZone.name,
    longitude: candidate.representative.geometry.coordinates[0],
    latitude: candidate.representative.geometry.coordinates[1],
    areaKm2: Number(candidate.areaKm2.toFixed(2)),
    geometry: candidate.feature.geometry,
    severity: config.incidentSeverity,
  }));
}
