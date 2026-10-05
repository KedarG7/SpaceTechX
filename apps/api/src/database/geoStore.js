import { HOSPITALS } from "../data/hospitals.js";
import { FACILITIES } from "../data/facilities.js";
import { haversineKm } from "../utils/geo.js";

let pool = null;
let postgisReady = false;

export function isPostgisEnabled() {
  return postgisReady;
}

export async function initDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[geo] DATABASE_URL not set — using in-memory geospatial engine (haversine).");
    return;
  }
  try {
    const pg = await import("pg");
    pool = new pg.Pool({ connectionString: url });
    await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hospitals (
        id TEXT PRIMARY KEY,
        name TEXT,
        state TEXT,
        district TEXT,
        category TEXT,
        emergency BOOLEAN,
        beds INTEGER,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        source TEXT,
        source_updated DATE,
        location GEOGRAPHY(POINT, 4326)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facilities (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        state TEXT,
        district TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        source TEXT,
        location GEOGRAPHY(POINT, 4326)
      );
    `);
    for (const h of HOSPITALS) {
      await pool.query(
        `INSERT INTO hospitals (id, name, state, district, category, emergency, beds, latitude, longitude, source, source_updated, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ST_SetSRID(ST_MakePoint($9,$8),4326)::geography)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           location = EXCLUDED.location`,
        [h.id, h.name, h.state, h.district, h.category, h.emergency, h.beds, h.latitude, h.longitude, h.source, h.sourceUpdated]
      );
    }
    for (const f of FACILITIES) {
      await pool.query(
        `INSERT INTO facilities (id, name, type, state, district, latitude, longitude, source, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ST_SetSRID(ST_MakePoint($7,$6),4326)::geography)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location`,
        [f.id, f.name, f.type, f.state, f.district, f.latitude, f.longitude, f.source]
      );
    }
    postgisReady = true;
    console.log("[geo] PostGIS ready — nearest-neighbour queries use geography.");
  } catch (error) {
    console.warn("[geo] PostGIS unavailable, falling back to in-memory engine:", error.message);
    pool = null;
    postgisReady = false;
  }
}

function attachDistance(records, lat, lon) {
  return records
    .map((r) => ({
      ...r,
      distanceKm: Number(haversineKm(lat, lon, r.latitude, r.longitude).toFixed(2)),
      distanceMethod: postgisReady ? "postgis_geography" : "haversine",
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export async function nearestHospitals(lat, lon, { limit = 5, radiusKm = 80 } = {}) {
  if (postgisReady && pool) {
    const { rows } = await pool.query(
      `SELECT id, name, state, district, category, emergency, beds, latitude, longitude, source, source_updated,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) / 1000 AS distance_km
         FROM hospitals
        WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
        ORDER BY location <-> ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
        LIMIT $4`,
      [lon, lat, radiusKm * 1000, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      district: r.district,
      category: r.category,
      emergency: r.emergency,
      beds: r.beds,
      bedsAvailability: "Unknown",
      operationalStatus: "Unknown",
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      distanceKm: Number(Number(r.distance_km).toFixed(2)),
      distanceMethod: "postgis_geography",
      source: r.source,
      sourceUpdated: r.source_updated,
    }));
  }

  return attachDistance(HOSPITALS, lat, lon)
    .filter((h) => h.distanceKm <= radiusKm)
    .slice(0, limit)
    .map((hospital) => ({
      ...hospital,
      bedsAvailability: hospital.bedsAvailability || "Unknown",
      operationalStatus: hospital.operationalStatus || "Unknown",
      source: hospital.source || "Government of India National Hospital Directory (compiled seed)",
      sourceUpdated: hospital.sourceUpdated || "2025-06-01",
    }));
}

export async function nearestFacilities(lat, lon, { limit = 40, radiusKm = 120 } = {}) {
  if (postgisReady && pool) {
    const { rows } = await pool.query(
      `SELECT id, name, type, state, district, latitude, longitude, source,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) / 1000 AS distance_km
         FROM facilities
        WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
        ORDER BY location <-> ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
        LIMIT $4`,
      [lon, lat, radiusKm * 1000, limit]
    );
    return rows.map((r) => ({
      ...r,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      distanceKm: Number(Number(r.distance_km).toFixed(2)),
      operationalStatus: "Unknown",
    }));
  }
  return attachDistance(FACILITIES, lat, lon)
    .filter((f) => f.distanceKm <= radiusKm)
    .slice(0, limit);
}

export function allHospitals() {
  return HOSPITALS;
}

export function hospitalStats() {
  const byState = {};
  for (const h of HOSPITALS) {
    byState[h.state] = (byState[h.state] || 0) + 1;
  }
  return {
    count: HOSPITALS.length,
    emergencyCapable: HOSPITALS.filter((h) => h.emergency).length,
    byState,
    source: "Government of India National Hospital Directory (compiled seed)",
    sourceUpdated: "2025-06-01",
    caveat: "Bed counts are directory figures, not live occupancy. Operational status is Unknown.",
  };
}
