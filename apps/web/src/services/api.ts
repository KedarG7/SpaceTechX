export type DisasterSummary = {
  id: string;
  code: string;
  name: string;
  category: string;
  subCategory?: string | null;
  countries: string[];
  state?: string | null;
  district?: string | null;
  centroid: { latitude: number; longitude: number } | null;
  severity: "critical" | "high" | "moderate" | string;
  closed: boolean;
  mode: "live" | "demo";
  source: string;
  reason?: string | null;
  eventTime?: string;
  activationTime?: string;
  lastUpdate?: string;
  relativeUpdate?: string;
  freshness?: "live" | "recent" | "stale";
  n_aois: number;
  n_products: number;
  india?: boolean;
  affectedAreaKm2?: number | null;
  impact?: {
    buildingsAffected?: number | null;
    roadsAffectedKm?: number | null;
    populationEstimated?: number | null;
    populationAffected?: number | null;
  };
};

export type DisasterDetail = DisasterSummary & {
  aois?: Array<{
    name: string;
    number: number;
    extentGeoJSON: GeoJSON.Geometry | null;
  }>;
  extentGeoJSON?: GeoJSON.Geometry | null;
  layers?: Array<{ name: string; json?: string | null; thematic?: string }>;
  dataConfidence?: Record<string, string>;
  productsPath?: string | null;
  imagery?: Array<{
    aoiName: string;
    productType: string;
    sensorName: string;
    sensorType: string;
    resolutionClass?: string;
    acquisitionTime?: string;
    fileName?: string;
    uuid?: string;
  }>;
};

export type Hospital = {
  id: string;
  name: string;
  state: string;
  district: string;
  category: string;
  emergency: boolean;
  beds?: number;
  bedsAvailability: string;
  operationalStatus: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  roadKm?: number;
  durationMin?: number;
  routeConfidence?: string;
  routeGeometry?: GeoJSON.Geometry;
  sourceUpdated?: string | null;
  source: string;
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

export type ClusterHospitalRoute = {
  id: string;
  rank: number;
  routeType: "recommended" | "alternative" | string;
  hospital: Hospital;
  roadKm: number | null;
  durationMin: number | null;
  routeStatus: "routed" | "unavailable" | string;
  routeConfidence: string;
  routeSource: string;
  routeGeometry: GeoJSON.Geometry | null;
  routeDirections: Array<{
    instruction: string;
    distanceKm: number | null;
    durationMin: number | null;
  }>;
  rankingBasis: string;
  selectionReason: string;
};

export type ClusterRoute = AffectedCluster & {
  hospitalRoutes: ClusterHospitalRoute[];
};

export type Facility = {
  id: string;
  name: string;
  type: string;
  state: string;
  district: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  source: string;
  operationalStatus?: string;
};

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
