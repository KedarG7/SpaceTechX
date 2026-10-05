/** Haversine distance in kilometres. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function parsePoint(point) {
  if (!point) return null;
  if (typeof point === "object" && point.longitude != null) {
    const longitude = Number(point.longitude);
    const latitude = Number(point.latitude);
    return Number.isFinite(longitude) &&
      Number.isFinite(latitude) &&
      Math.abs(longitude) <= 180 &&
      Math.abs(latitude) <= 90
      ? { longitude, latitude }
      : null;
  }
  const match = String(point).match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  return Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
    ? { longitude, latitude }
    : null;
}

function parseWktGroup(text, cursor) {
  while (/\s/.test(text[cursor.index] || "")) cursor.index += 1;
  if (text[cursor.index] !== "(") return null;
  cursor.index += 1;
  const values = [];
  while (cursor.index < text.length) {
    while (/\s/.test(text[cursor.index] || "")) cursor.index += 1;
    if (text[cursor.index] === "(") {
      const nested = parseWktGroup(text, cursor);
      if (!nested) return null;
      values.push(nested);
    } else {
      const start = cursor.index;
      while (cursor.index < text.length && ![",", ")"].includes(text[cursor.index])) {
        cursor.index += 1;
      }
      const pair = text.slice(start, cursor.index).trim().split(/\s+/).map(Number);
      if (pair.length < 2 || !pair.every(Number.isFinite)) return null;
      values.push(pair.slice(0, 2));
    }
    while (/\s/.test(text[cursor.index] || "")) cursor.index += 1;
    if (text[cursor.index] === ",") {
      cursor.index += 1;
      continue;
    }
    if (text[cursor.index] === ")") {
      cursor.index += 1;
      return values;
    }
    return null;
  }
  return null;
}

function closeAndValidateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const coordinates = ring.map((position) => {
    if (
      !Array.isArray(position) ||
      position.length !== 2 ||
      !position.every(Number.isFinite) ||
      Math.abs(position[0]) > 180 ||
      Math.abs(position[1]) > 90
    ) return null;
    return [position[0], position[1]];
  });
  if (coordinates.some((position) => position === null)) return null;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
  return coordinates.length >= 4 ? coordinates : null;
}

export function parsePolygon(wkt) {
  if (!wkt) return null;
  const text = String(wkt).trim();
  const kind = text.match(/^(MULTIPOLYGON|POLYGON)\s*/i)?.[1]?.toUpperCase();
  if (!kind) return null;
  const cursor = { index: text.indexOf("(") };
  const tree = parseWktGroup(text, cursor);
  if (!tree) return null;
  const asRings = (rings) => Array.isArray(rings)
    ? rings.map(closeAndValidateRing)
    : null;
  let geometry;
  if (kind === "POLYGON") {
    const coordinates = asRings(tree);
    if (!coordinates?.length || coordinates.some((ring) => !ring)) return null;
    geometry = { type: "Polygon", coordinates };
  } else {
    const polygons = tree.map(asRings);
    if (
      !polygons.length ||
      polygons.some((rings) => !rings?.length || rings.some((ring) => !ring))
    ) return null;
    geometry = { type: "MultiPolygon", coordinates: polygons };
  }
  try {
    const parsed = feature(geometry);
    return booleanValid(parsed) && kinks(parsed).features.length === 0 ? geometry : null;
  } catch {
    return null;
  }
}

export function polygonToFeature(wkt, properties = {}) {
  const geometry = parsePolygon(wkt);
  if (!geometry) return null;
  return { type: "Feature", properties, geometry };
}

export function centroidOfPolygon(geometry) {
  if (!geometry) return null;
  try {
    const shape = feature(geometry);
    if (!booleanValid(shape) || kinks(shape).features.length > 0) return null;
    const center = centerOfMass(shape);
    const representative = booleanPointInPolygon(center, shape) ? center : pointOnFeature(shape);
    const [longitude, latitude] = representative.geometry.coordinates;
    return { longitude, latitude };
  } catch {
    return null;
  }
}

/** Approximate geodesic area in km² from a GeoJSON polygon. */
export function polygonAreaKm2(geometry) {
  if (!geometry) return null;
  try {
    const shape = feature(geometry);
    return booleanValid(shape) && kinks(shape).features.length === 0
      ? area(shape) / 1_000_000
      : null;
  } catch {
    return null;
  }
}

export function circlePolygon(lon, lat, radiusKm = 8, steps = 32) {
  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon =
      (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

export function relativeTime(iso) {
  if (!iso) return "Unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function freshnessTier(iso) {
  if (!iso) return "stale";
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 6) return "live";
  if (hours < 72) return "recent";
  return "stale";
}

export function sumStats(stats, keys) {
  if (!stats) return { total: 0, affected: 0 };
  let total = 0;
  let affected = 0;
  for (const group of Object.values(stats)) {
    if (!group || typeof group !== "object") continue;
    for (const [label, metric] of Object.entries(group)) {
      if (keys && !keys.some((k) => label.toLowerCase().includes(k))) continue;
      if (metric && typeof metric === "object") {
        const t = Number(metric.total);
        const a = Number(metric.affected);
        if (Number.isFinite(t)) total += t;
        if (Number.isFinite(a)) affected += a;
      }
    }
  }
  return { total, affected };
}

export function flattenImpact(productStats) {
  const buildings = sumStats(productStats, ["building", "built", "residential", "institutional"]);
  const roads = sumStats(productStats, ["road", "highway", "track", "bridge"]);
  const population = productStats?.["Estimated population"]?.None ||
    productStats?.["Estimated population"]?.none ||
    {};
  return {
    buildingsAffected: buildings.affected,
    buildingsTotal: buildings.total,
    roadsAffectedKm: Number(roads.affected.toFixed(1)),
    roadsTotalKm: Number(roads.total.toFixed(1)),
    populationEstimated: Number(population.total) || null,
    populationAffected: Number(population.affected) || null,
  };
}
import {
  area,
  booleanPointInPolygon,
  booleanValid,
  centerOfMass,
  feature,
  kinks,
  pointOnFeature,
} from "@turf/turf";
