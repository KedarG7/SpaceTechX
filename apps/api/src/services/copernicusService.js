import {
  flattenImpact,
  parsePoint,
  parsePolygon,
  polygonAreaKm2,
  relativeTime,
  freshnessTier,
} from "../utils/geo.js";
import { DEMO_INCIDENTS } from "../data/demoIncidents.js";

const CEMS_LIST =
  "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/";
const CEMS_DETAIL =
  "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/";

const SOUTH_ASIA = new Set([
  "india",
  "nepal",
  "bangladesh",
  "bhutan",
  "sri lanka",
  "maldives",
  "myanmar",
  "pakistan",
  "afghanistan",
]);

const cache = {
  list: { at: 0, data: null, error: null },
  details: new Map(),
};

const LIST_TTL = 10 * 60 * 1000;
const DETAIL_TTL = 30 * 60 * 1000;

function countryNames(countries) {
  if (!Array.isArray(countries)) return [];
  return countries
    .map((c) => (typeof c === "string" ? c : c?.name))
    .filter(Boolean);
}

function matchesIndia(names) {
  return names.some((n) => n.toLowerCase() === "india");
}

function matchesSouthAsia(names) {
  return names.some((n) => SOUTH_ASIA.has(n.toLowerCase()));
}

function severityFrom(raw, impact) {
  if (!raw.closed && (impact.populationAffected || 0) > 20000) return "critical";
  if (!raw.closed) return "high";
  const pop = impact.populationAffected || impact.populationEstimated || 0;
  const bld = impact.buildingsAffected || 0;
  if (pop > 20000 || bld > 1500) return "critical";
  if (pop > 5000 || bld > 400) return "high";
  return "moderate";
}

function inferState(name, countries) {
  if (!matchesIndia(countries)) return null;
  const text = `${name}`.toLowerCase();
  const states = [
    "assam",
    "maharashtra",
    "kerala",
    "odisha",
    "uttarakhand",
    "himachal pradesh",
    "tamil nadu",
    "bihar",
    "west bengal",
    "gujarat",
    "delhi",
    "karnataka",
    "andhra pradesh",
    "telangana",
    "uttar pradesh",
    "rajasthan",
    "madhya pradesh",
    "manipur",
    "meghalaya",
    "sikkim",
    "goa",
    "jammu and kashmir",
    "punjab",
  ];
  return states.find((s) => text.includes(s)) || "India (state not specified in CEMS record)";
}

function aggregateImpact(activation) {
  const fromTop = activation.stats || {};
  let buildingsAffected = 0;
  let roadsAffectedKm = Number(fromTop["Roads [km]"]) || 0;
  let populationAffected = Number(fromTop["Population [No.]"]) || 0;
  let populationEstimated = populationAffected;
  let landUseAffectedHa = Number(fromTop["max_extent"]) || Number(fromTop["Event Extent [ha]"]) || 0;

  for (const aoi of activation.aois || []) {
    for (const product of aoi.products || []) {
      if (!product.stats) continue;
      const flat = flattenImpact(product.stats);
      buildingsAffected += flat.buildingsAffected;
      if (flat.roadsAffectedKm) roadsAffectedKm += flat.roadsAffectedKm;
      if (flat.populationAffected) populationAffected += flat.populationAffected;
      if (flat.populationEstimated) populationEstimated += flat.populationEstimated;
    }
  }

  if (activation.stats?.["Identified buildings [No.]"]) {
    buildingsAffected = Math.max(buildingsAffected, Number(activation.stats["Identified buildings [No.]"]) || 0);
  }

  return {
    buildingsAffected: Math.round(buildingsAffected) || null,
    buildingsTotal: null,
    roadsAffectedKm: roadsAffectedKm ? Number(roadsAffectedKm.toFixed(1)) : null,
    roadsTotalKm: null,
    populationEstimated: Number.isFinite(populationEstimated) && populationEstimated > 0 ? populationEstimated : null,
    populationAffected: Number.isFinite(populationAffected) && populationAffected > 0 ? populationAffected : null,
    landUseAffectedHa: landUseAffectedHa || null,
  };
}

function collectLayers(activation) {
  const layers = [];
  const bucket = activation.aws_bucket || "https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com";
  for (const aoi of activation.aois || []) {
    for (const product of aoi.products || []) {
      for (const layer of product.layers || []) {
        const json =
          layer.json ||
          (layer.format === "vt"
            ? `${bucket}/${String(layer.name).replace(/_VT$/, "")}.json`
            : null);
        layers.push({
          name: layer.name,
          format: layer.format,
          json,
          sld: layer.sld,
          aoiName: aoi.name,
          productType: product.type,
          thematic: thematicFromName(layer.name),
        });
      }
    }
  }
  return layers;
}

function thematicFromName(name = "") {
  const n = name.toLowerCase();
  if (n.includes("observedevent")) return "affected_area";
  if (n.includes("builtup")) return "buildings";
  if (n.includes("transportation")) return "roads";
  if (n.includes("facilit")) return "facilities";
  if (n.includes("naturallanduse") || n.includes("landuse")) return "land_use";
  return "other";
}

export function summarizeActivation(raw, { mode = "live" } = {}) {
  const countries = countryNames(raw.countries);
  const centroid = parsePoint(raw.centroid);
  const extent = parsePolygon(raw.extent);
  const impact = mode === "live" ? aggregateImpact(raw) : raw.impact;
  const areaKm2 =
    raw.affectedAreaKm2 ||
    (extent ? Number(polygonAreaKm2(extent)?.toFixed(1)) : null);

  return {
    id: raw.code || raw.id,
    code: raw.code || raw.id,
    name: raw.name,
    category: raw.category,
    subCategory: raw.subCategory || null,
    countries,
    state: raw.state || inferState(raw.name, countries),
    district: raw.district || null,
    centroid,
    severity: raw.severity || severityFrom(raw, impact || {}),
    closed: Boolean(raw.closed),
    mode,
    source: mode === "live" ? "Copernicus EMS Rapid Mapping" : raw.source,
    copernicusRef: raw.copernicusRef || (mode === "live" ? raw.code : null),
    reason: raw.reason || null,
    eventTime: raw.eventTime,
    activationTime: raw.activationTime,
    lastUpdate: raw.lastUpdate || raw.activationTime,
    relativeUpdate: relativeTime(raw.lastUpdate || raw.activationTime),
    freshness: freshnessTier(raw.lastUpdate || raw.activationTime),
    n_aois: raw.n_aois ?? raw.aois?.length ?? 0,
    n_products: raw.n_products ?? 0,
    gdacsId: raw.gdacsId || null,
    india: matchesIndia(countries),
    southAsia: matchesSouthAsia(countries),
    affectedAreaKm2: areaKm2,
    impact: impact || {},
    reportLink: raw.reportLink || null,
  };
}

export function hydrateDetail(raw, { mode = "live" } = {}) {
  const summary = summarizeActivation(raw, { mode });
  const aois = (raw.aois || []).map((aoi) => ({
    name: aoi.name,
    number: aoi.number,
    extentGeoJSON: aoi.extentGeoJSON || parsePolygon(aoi.extent),
    products: (aoi.products || []).map((p) => ({
      id: p.id,
      type: p.type,
      monitoring: p.monitoring,
      feasible: p.feasible,
      stats: p.stats,
      impact: p.stats ? flattenImpact(p.stats) : null,
      downloadPath: p.downloadPath,
      expectedDelivery: p.expectedDelivery,
      version: p.version,
    })),
  }));

  return {
    ...summary,
    reason: raw.reason,
    aois,
    extentGeoJSON: raw.extentGeoJSON || parsePolygon(raw.extent),
    layers: mode === "live" ? collectLayers(raw) : [],
    aws_bucket: raw.aws_bucket,
    productsPath: raw.productsPath,
    dataConfidence: raw.dataConfidence || {
      disaster: "Copernicus EMS Rapid Mapping public API",
      area: "Copernicus EMS AOI / product extent (WKT)",
      hospitals: "Government of India National Hospital Directory (compiled seed)",
      roads: "OpenStreetMap via OSRM",
    },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Copernicus request failed (${response.status})`);
  }
  return response.json();
}

export async function getActivations() {
  const now = Date.now();
  if (cache.list.data && now - cache.list.at < LIST_TTL) {
    return cache.list.data;
  }
  try {
    const all = [];
    let url = `${CEMS_LIST}?limit=100`;
    while (url) {
      const page = await fetchJson(url);
      all.push(...(page.results || []));
      url = page.next;
    }
    cache.list = { at: now, data: all, error: null };
    return all;
  } catch (error) {
    cache.list.error = error.message;
    if (cache.list.data) return cache.list.data;
    throw error;
  }
}

export async function getActivationDetail(code) {
  const key = code.toUpperCase();
  const cached = cache.details.get(key);
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.data;
  const payload = await fetchJson(`${CEMS_DETAIL}?code=${encodeURIComponent(key)}`);
  const raw = payload.results?.[0];
  if (!raw) return null;
  cache.details.set(key, { at: Date.now(), data: raw });
  return raw;
}

export async function listDisasters({ mode = "india", country = "india" } = {}) {
  let live = [];
  let liveError = null;
  try {
    const activations = await getActivations();
    live = activations.map((a) => summarizeActivation(a, { mode: "live" }));
  } catch (error) {
    liveError = error.message;
  }

  const demo = DEMO_INCIDENTS.map((d) => summarizeActivation(d, { mode: "demo" }));
  const liveIndia = live.filter((d) => d.india);
  const liveRegional = live.filter((d) => d.southAsia && !d.india);

  let items;
  if (mode === "live") {
    items = country === "all" ? live : live.filter((d) => d.india);
  } else if (mode === "demo") {
    items = demo;
  } else if (mode === "regional") {
    items = [...liveIndia, ...liveRegional, ...demo];
  } else {
    items = liveIndia.length ? [...liveIndia, ...demo] : demo;
  }

  items.sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0));

  return {
    mode,
    liveIndiaCount: liveIndia.length,
    liveCount: live.length,
    liveError,
    copernicusFetchedAt: cache.list.at ? new Date(cache.list.at).toISOString() : null,
    items,
    notice:
      liveIndia.length === 0
        ? "No live Copernicus Rapid Mapping activations currently list India. Dashboard is using the India historical/demo catalogue so the operations workflow remains demonstrable."
        : "Live Copernicus EMS activations for India are available and merged with the historical/demo catalogue.",
  };
}

export async function getDisaster(id) {
  const demo = DEMO_INCIDENTS.find((d) => d.id === id || d.code === id);
  if (demo) return hydrateDetail(demo, { mode: "demo" });
  const raw = await getActivationDetail(id);
  if (!raw) return null;
  return hydrateDetail(raw, { mode: "live" });
}

export function getDemoById(id) {
  return DEMO_INCIDENTS.find((d) => d.id === id || d.code === id) || null;
}

export function copernicusFreshness() {
  return {
    source: "Copernicus EMS Rapid Mapping",
    fetchedAt: cache.list.at ? new Date(cache.list.at).toISOString() : null,
    relative: cache.list.at ? relativeTime(new Date(cache.list.at).toISOString()) : "not fetched",
    tier: cache.list.at ? freshnessTier(new Date(cache.list.at).toISOString()) : "stale",
    error: cache.list.error,
  };
}

export const ALLOWED_GEOJSON_HOSTS = new Set([
  "rapidmapping-viewer.s3.eu-west-1.amazonaws.com",
  "rapidmapping.emergency.copernicus.eu",
]);
