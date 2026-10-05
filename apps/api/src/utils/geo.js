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
  if (typeof point === "object" && point.longitude != null) return point;
  const match = String(point).match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!match) return null;
  return { longitude: Number(match[1]), latitude: Number(match[2]) };
}

export function parsePolygon(wkt) {
  if (!wkt) return null;
  const match = String(wkt).match(/POLYGON\s*\(\((.+)\)\)/i);
  if (!match) return null;
  const rings = match[1].split("),(");
  const coordinates = rings.map((ring) =>
    ring
      .split(",")
      .map((pair) => pair.trim().split(/\s+/).map(Number))
      .filter((xy) => xy.length === 2 && xy.every(Number.isFinite))
  );
  if (!coordinates[0]?.length) return null;
  const first = coordinates[0][0];
  const last = coordinates[0][coordinates[0].length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates[0].push([...first]);
  }
  return { type: "Polygon", coordinates };
}

export function polygonToFeature(wkt, properties = {}) {
  const geometry = parsePolygon(wkt);
  if (!geometry) return null;
  return { type: "Feature", properties, geometry };
}

export function centroidOfPolygon(geometry) {
  if (!geometry?.coordinates?.[0]) return null;
  const ring = geometry.coordinates[0];
  let x = 0;
  let y = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return { longitude: x / n, latitude: y / n };
}

/** Approximate geodesic area in km² from a GeoJSON polygon. */
export function polygonAreaKm2(geometry) {
  if (!geometry?.coordinates?.[0]) return null;
  const ring = geometry.coordinates[0];
  const R = 6371.0088;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area +=
      ((lon2 - lon1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((area * R * R) / 2);
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
