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
  severityBasis?: string;
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
    new?: boolean | null;
  }>;
  impactPoints?: Array<{
    id?: string;
    latitude: number;
    longitude: number;
    severity?: string;
    severityBasis?: string;
    population?: number | null;
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
  severity?: string;
  populationEstimate?: number | null;
  populationEstimateMethod?: string;
  originMethod?: string;
  assignedHospitalId?: string | null;
  assignmentStatus?: string;
  routingStatus?: string;
  routingFailure?: string | null;
  debug?: {
    clusterConfig: {
      radiusKm: number;
      minimumAffectedPoints: number;
      maxClusters: number;
    };
    clusterOriginMethod: string;
    pointObservationStatus: string;
    roadMatrixCandidateCount: number;
    candidateScores: Array<{
      hospitalId: string;
      hospitalName: string;
      roadKm: number;
      durationMin: number;
      score: number;
      scoreBreakdown: Record<string, number>;
    }>;
    rejectedCandidates: Array<{
      hospitalId: string;
      hospitalName: string;
      reason: string;
    }>;
    attemptedCandidateCount: number;
  };
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
  score?: number;
  scoreBreakdown?: Record<string, number>;
  scoreWeights?: Record<string, number>;
  estimatedTravelTime?: boolean;
  liveTraffic?: boolean;
  routeSnapDistanceKm?: { origin: number; destination: number };
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
  const res = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw await responseError(res);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await responseError(res);
  return res.json();
}

async function responseError(response: Response) {
  let payload: { error?: string; sessionExpired?: boolean } = {};
  try {
    payload = await response.json();
  } catch {
    // Keep a small generic error when a response is not JSON.
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("ndrf:session-expired", {
      detail: { sessionExpired: payload.sessionExpired === true },
    }));
  }
  return new Error(payload.error || `Request failed (${response.status}).`);
}
