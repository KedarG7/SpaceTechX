import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ambulance,
  ChevronDown,
  ExternalLink,
  FileText,
  Flame,
  Hospital as HospitalIcon,
  Image as ImageIcon,
  Layers,
  MapPinned,
  Route,
  Siren,
  ShieldCheck,
  Users,
} from "lucide-react";
import DisasterMap from "./map/DisasterMap";
import { buildAffectedClusters, type ClusterConfig } from "./map/clusterZones";
import TopBar from "./components/TopBar";
import LoginScreen from "./components/LoginScreen";
import {
  apiGet,
  apiPost,
  type DisasterDetail,
  type DisasterSummary,
  type ClusterRoute,
  type Facility,
  type Hospital,
} from "./services/api";
import { buildImageryReportTable } from "./services/responseReport";
import type { ParentZone } from "./map/clusterZones";

const INDIA_STATES_AND_UTS = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
  "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
  "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

const LAYER_DEFAULTS: Record<string, boolean> = {
  imagery: true,
  aoi: true,
  clusters: true,
  hospitals: true,
  infrastructure: true,
  routes: true,
  fire_station: true,
  police: true,
  ambulance: true,
  ndrf: true,
  relief_centre: true,
  helipad: true,
  water: false,
  power: false,
  government: false,
};

const CLUSTER_CONFIG: ClusterConfig = {
  radiusKm: Number(import.meta.env.VITE_CLUSTER_RADIUS_KM) || 5,
  minimumAffectedPoints: Number(import.meta.env.VITE_CLUSTER_MIN_AFFECTED_POINTS) || 3,
  maxClusters: Math.min(12, Math.max(1, Number(import.meta.env.VITE_MAX_CLUSTERS) || 12)),
};

function formatNum(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "Unknown";
  return new Intl.NumberFormat("en-IN").format(n);
}

function hospitalAvailabilityStatus(hospital: Hospital) {
  const status = `${hospital.operationalStatus || ""} ${hospital.bedsAvailability || ""}`.toLowerCase();
  if (/high load|overload|critical|full/.test(status)) return "high load";
  if (/limited|low capacity/.test(status)) return "limited capacity";
  if (/available|operational/.test(status)) return "available";
  return "availability unknown";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function googleMapsDirectionsUrl(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
) {
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function safeHttpsUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function geometryBounds(geometry: GeoJSON.Geometry | null | undefined) {
  if (!geometry) return null;
  const coordinates = "coordinates" in geometry ? geometry.coordinates : null;
  if (!coordinates) return null;
  const points: Array<[number, number]> = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      points.push([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };
  visit(coordinates);
  if (!points.length) return null;
  return points.reduce(
    (bounds, [longitude, latitude]) => ({
      west: Math.min(bounds.west, longitude),
      south: Math.min(bounds.south, latitude),
      east: Math.max(bounds.east, longitude),
      north: Math.max(bounds.north, latitude),
    }),
    { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  );
}

type AuthenticatedOperator = { email: string };

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [operator, setOperator] = useState<AuthenticatedOperator | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [path, setPath] = useState(window.location.pathname);

  function navigate(nextPath: string, replace = false) {
    if (replace) window.history.replaceState({}, "", nextPath);
    else window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.ok && result?.authenticated === true && typeof result?.user?.email === "string") {
          setOperator({ email: result.user.email });
        } else if (result?.sessionExpired === true) {
          setAuthNotice("Your secure session has expired. Please authenticate again.");
        } else if (response.status >= 500) {
          setAuthNotice("Authentication service unavailable. Please try again.");
        }
        setAuthChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setAuthNotice("Authentication service unavailable. Please try again.");
        setAuthChecked(true);
      });
    const onSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionExpired?: boolean }>).detail;
      setOperator(null);
      setAuthNotice(detail?.sessionExpired
        ? "Your secure session has expired. Please authenticate again."
        : "Your secure session is no longer active. Please authenticate again.");
      setAuthChecked(true);
    };
    window.addEventListener("ndrf:session-expired", onSessionExpired);
    return () => {
      active = false;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("ndrf:session-expired", onSessionExpired);
    };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (operator && path !== "/command-center") navigate("/command-center", true);
    else if (!operator && path !== "/login") navigate("/login", true);
  }, [authChecked, operator, path]);

  async function logout() {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Logout failed");
    setOperator(null);
    setAuthNotice(null);
    navigate("/login", true);
  }

  if (!authChecked) {
    return <main className="auth-check"><span className="login-spinner" /> Verifying secure session…</main>;
  }
  if (!operator) {
    return <LoginScreen notice={authNotice} onAuthenticated={(email) => {
      setOperator({ email });
      setAuthNotice(null);
    }} />;
  }
  return <Dashboard operatorEmail={operator.email} onLogout={logout} />;
}

function Dashboard({
  operatorEmail,
  onLogout,
}: {
  operatorEmail: string;
  onLogout: () => Promise<void>;
}) {
  const [clock, setClock] = useState("");
  const [mode, setMode] = useState("india");
  const [list, setList] = useState<DisasterSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveIndia, setLiveIndia] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DisasterDetail | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [layers, setLayers] = useState(LAYER_DEFAULTS);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [expandedClusterIds, setExpandedClusterIds] = useState<string[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [clusterRoutes, setClusterRoutes] = useState<ClusterRoute[]>([]);
  const [clusterRoutesLoading, setClusterRoutesLoading] = useState(false);
  const [clusterRoutesError, setClusterRoutesError] = useState<string | null>(null);
  const [clusterRetrySequence, setClusterRetrySequence] = useState(0);
  const [routingProvider, setRoutingProvider] = useState<string>("OSRM");
  const [routeMatrixError, setRouteMatrixError] = useState<string | null>(null);
  const [hospitalDataNotice, setHospitalDataNotice] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("all");
  const [incidentQuery, setIncidentQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [routingDebug, setRoutingDebug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const mapSnapshotRef = useRef<(() => string | null) | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-IN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })
      );
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    setIsRefreshing(true);
    setLoadError(null);
    (async () => {
      const data = await apiGet<{
        items: DisasterSummary[];
        notice: string;
        liveIndiaCount: number;
        liveError?: string | null;
      }>(`/api/disasters?mode=${mode}&refresh=${refreshSequence ? "1" : "0"}`);
      if (cancel) return;
      setList(data.items);
      setNotice(
        data.liveError
          ? `Copernicus live feed unavailable: ${data.liveError}`
          : mode === "demo"
            ? "Demo and historical incidents"
            : data.liveIndiaCount
              ? `${data.liveIndiaCount} active Copernicus EMS incidents in India`
              : "No live India activations · showing historical incidents"
      );
      setLiveIndia(data.liveIndiaCount);
      setSelectedId((current) => current || data.items[0]?.id || null);
    })()
      .catch((error: unknown) => {
        console.error("Unable to load disaster activations", error);
        if (!cancel) setLoadError("Disaster feed unavailable. Check the API connection and try refreshing.");
      })
      .finally(() => {
        if (!cancel) setIsRefreshing(false);
      });
    return () => {
      cancel = true;
    };
  }, [mode, refreshSequence]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRefreshSequence((sequence) => sequence + 1);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancel = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const d = await apiGet<DisasterDetail>(`/api/disasters/${selectedId}`);
      if (cancel) return;
      setDetail(d);
      const [h, f] = await Promise.all([
        apiGet<{ hospitals: Hospital[] }>(`/api/disasters/${selectedId}/hospitals?limit=8&route=0`),
        apiGet<{ facilities: Facility[] }>(`/api/disasters/${selectedId}/facilities`),
      ]);
      if (cancel) return;
      setHospitals(h.hospitals);
      setFacilities(f.facilities);
      setHospitalId(h.hospitals[0]?.id || null);
    })()
      .catch((error: unknown) => {
        console.error("Unable to load incident response details", error);
        if (!cancel) setLoadError("Incident details or response resources could not be loaded.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [selectedId]);

  const parentZones = useMemo<ParentZone[]>(() => {
    if (!detail) return [];
    const zones = (detail.aois || [])
      .filter((aoi) => aoi.extentGeoJSON)
      .map((aoi) => ({
        id: `${detail.code}-AOI-${aoi.number}`,
        name: aoi.name || `Affected area ${aoi.number}`,
        geometry: aoi.extentGeoJSON,
      }));
    return zones.length
      ? zones
      : [{
          id: detail.code,
          name: detail.name,
          geometry: detail.extentGeoJSON || null,
        }];
  }, [detail]);
  const clusterOrigins = useMemo(
    () => buildAffectedClusters(parentZones, detail?.centroid, CLUSTER_CONFIG.maxClusters, {
      impactPoints: detail?.impactPoints,
      incidentSeverity: detail?.severity,
      ...CLUSTER_CONFIG,
    }),
    [parentZones, detail?.centroid, detail?.impactPoints]
  );

  useEffect(() => {
    if (!selectedId || !clusterOrigins.length) {
      setClusterRoutes([]);
      return;
    }
    let cancel = false;
    setClusterRoutes([]);
    setClusterRoutesError(null);
    setRouteMatrixError(null);
    setClusterRoutesLoading(true);
    apiPost<{
      clusters: ClusterRoute[];
      routingProvider?: { provider?: string };
      routeMatrixError?: string | null;
      hospitalSourceQuality?: string;
    }>(`/api/disasters/${selectedId}/cluster-routes`, {
      clusters: clusterOrigins,
      debug: routingDebug,
      clusterConfig: CLUSTER_CONFIG,
    })
      .then((data) => {
        if (!cancel) {
          setClusterRoutes(data.clusters);
          setRoutingProvider(data.routingProvider?.provider || "OSRM");
          setRouteMatrixError(data.routeMatrixError || null);
          setHospitalDataNotice(data.hospitalSourceQuality || null);
          const firstCluster = data.clusters[0];
          setSelectedClusterId(firstCluster?.id || null);
          setExpandedClusterIds(firstCluster ? [firstCluster.id] : []);
          setSelectedRouteId(firstCluster?.hospitalRoutes[0]?.id || null);
          setHospitalId(firstCluster?.hospitalRoutes[0]?.hospital.id || null);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to load affected-area cluster routes", error);
        if (!cancel) {
          const message = error instanceof Error ? error.message.slice(0, 180) : "Unknown API error";
          setClusterRoutesError(`Cluster routing unavailable: ${message}`);
        }
      })
      .finally(() => {
        if (!cancel) setClusterRoutesLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [selectedId, clusterOrigins, detail, clusterRetrySequence, routingDebug]);

  const states = useMemo(() => {
    const additionalStates = list
      .map((item) => item.state || item.countries.join(", "))
      .filter((state) => state && !INDIA_STATES_AND_UTS.includes(state));
    return ["all", ...INDIA_STATES_AND_UTS, ...Array.from(new Set(additionalStates)).sort()];
  }, [list]);

  const filtered = list.filter((i) => {
    if (stateFilter !== "all" && (i.state || i.countries.join(", ")) !== stateFilter) return false;
    if (severityFilter !== "all" && i.severity !== severityFilter) return false;
    const query = incidentQuery.trim().toLowerCase();
    if (
      query &&
      ![i.name, i.code, i.category, i.state, i.district]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ) return false;
    return true;
  });
  const incidentGroups = Array.from(
    filtered.reduce((groups, item) => {
      const state = item.state || item.countries.join(", ") || "Location not specified";
      groups.set(state, [...(groups.get(state) || []), item]);
      return groups;
    }, new Map<string, DisasterSummary[]>())
  ).sort(([left], [right]) => left.localeCompare(right));

  function generateReportPdf() {
    if (!detail) return;
    if (clusterRoutesLoading || clusterRoutesError) {
      setReportError("Finish or retry cluster routing before exporting the response report.");
      return;
    }
    setReportError(null);
    const reportFrame = document.createElement("iframe");
    reportFrame.title = "Response report print view";
    reportFrame.setAttribute("aria-hidden", "true");
    reportFrame.style.position = "fixed";
    reportFrame.style.width = "0";
    reportFrame.style.height = "0";
    reportFrame.style.border = "0";
    reportFrame.style.visibility = "hidden";
    document.body.append(reportFrame);
    const cleanupTimer = window.setTimeout(() => reportFrame.remove(), 10 * 60 * 1000);
    const cleanupReportFrame = () => {
      window.clearTimeout(cleanupTimer);
      reportFrame.remove();
    };
    const mapSnapshot = mapSnapshotRef.current?.() || null;
    const mainCoordinates = detail.centroid
      ? `${detail.centroid.latitude.toFixed(5)}, ${detail.centroid.longitude.toFixed(5)} (latitude, longitude)`
      : "Not provided by source";
    const affectedZones = parentZones.map((zone) => {
      const matchingAoi = detail.aois?.find((aoi) => zone.id.endsWith(`AOI-${aoi.number}`));
      const bounds = geometryBounds(matchingAoi?.extentGeoJSON || detail.extentGeoJSON);
      const boundsText = bounds
        ? `${bounds.south.toFixed(5)}, ${bounds.west.toFixed(5)} to ${bounds.north.toFixed(5)}, ${bounds.east.toFixed(5)} (south-west to north-east; latitude, longitude)`
        : "Boundary coordinates not available";
      return `<li><strong>${escapeHtml(zone.name)}</strong><br><span class="muted">Zone ID ${escapeHtml(zone.id)} · boundary bounds: ${escapeHtml(boundsText)}</span></li>`;
    }).join("");
    const clusterContent = clusterRoutes.map((cluster) => {
      const routeContent = cluster.hospitalRoutes.map((route) => {
        const mapsUrl = googleMapsDirectionsUrl(cluster, route.hospital);
        return `<article class="route"><h4>${route.rank === 1 ? "Recommended hospital" : `Nearby alternative ${route.rank}`} · ${escapeHtml(route.hospital.name)}</h4><div class="route-metrics"><span><b>${route.roadKm == null ? "Unavailable" : `${route.roadKm} km`}</b><small>Road distance</small></span><span><b>${route.durationMin == null ? "Unavailable" : `${route.durationMin} min`}</b><small>Estimated ETA</small></span><span><b>${escapeHtml(route.routeStatus)}</b><small>Route status</small></span></div><p class="muted">Capacity and live availability are not supplied. ETA excludes live traffic.</p><p><a href="${escapeHtml(mapsUrl)}">Open route in Google Maps</a></p></article>`;
      }).join("");
      return `<section class="cluster"><div class="cluster-heading"><h3>${escapeHtml(cluster.name)} <span class="muted">· ${escapeHtml(cluster.id)}</span></h3><span class="severity">${escapeHtml(cluster.severity || detail.severity)}</span></div><p class="muted">${escapeHtml(cluster.parentZoneName)} · ${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)} · ${cluster.areaKm2 == null ? "Area unavailable" : `${cluster.areaKm2} km²`}</p>${routeContent || '<p class="muted">No validated road route is available for this cluster.</p>'}</section>`;
    }).join("");
    const imageryContent = buildImageryReportTable(detail.imagery);
    const productArchive = safeHttpsUrl(detail.productsPath);
    const imageSource = productArchive
      ? `<p><a href="${escapeHtml(productArchive)}">Open official Copernicus EMS analysis-product archive</a></p>`
      : `<p class="muted">No downloadable product archive was provided by the source activation.</p>`;
    const mapSection = mapSnapshot
      ? `<figure><img class="map-image" src="${mapSnapshot}" alt="Satellite basemap with affected clusters and hospital routes"><figcaption>Esri satellite basemap with the incident, cluster, facility, and route overlays. This is not the Copernicus source acquisition imagery.</figcaption></figure>`
      : `<p class="muted">Map snapshot could not be captured in this browser. Use the Google Maps route links below for navigation.</p>`;
    const shortDescription = (detail.reason || "No short incident summary supplied by the source.").slice(0, 360);
    const reportHtml = `<!doctype html>
      <html><head><meta charset="utf-8"><title>Response report - ${escapeHtml(detail.code)}</title>
      <style>
        *{box-sizing:border-box} @page{margin:14mm} body{font:12px/1.5 Arial,sans-serif;color:#152536;margin:24px auto;max-width:860px;padding:0 24px}
        .masthead{margin:0 -24px 18px;padding:18px 24px 16px;background:#071321;color:#e8f3ff;border-bottom:3px solid #00a8d8;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .brandline{display:flex;align-items:center;justify-content:space-between;gap:14px;color:#a7bdcd;font:10px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
        .brand{font-weight:700;color:#e8f3ff}.prototype{border:1px solid #80662f;padding:4px 7px;color:#ead8a8;font-size:8px}
        h1{font-size:22px;line-height:1.2;margin:15px 0 4px;color:#fff}h2{font-size:15px;margin:20px 0 7px;padding-bottom:5px;border-bottom:1px solid #cad7e2;color:#123c59}
        h3{font-size:13px;margin:0;color:#154c70}h4{font-size:12px;margin:8px 0 6px;color:#152536}.sub,.muted{font-size:10px;color:#5e7180}.incident{border:1px solid #d5e0e8;border-left:3px solid #1386b0;padding:12px 14px;background:#f3f7f9}
        section.cluster{break-inside:avoid;border:1px solid #d5e0e8;padding:11px 13px;margin:10px 0}.cluster-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.severity{border:1px solid #b5c9d7;padding:2px 6px;color:#27516a;font:9px ui-monospace,Menlo,monospace;text-transform:uppercase}
        .route{border-top:1px solid #e2e8ee;padding-top:5px;margin-top:8px}.route-metrics{display:flex;gap:20px;margin:7px 0}.route-metrics span{display:flex;flex-direction:column;min-width:90px}.route-metrics b{font:600 12px ui-monospace,Menlo,monospace;color:#064c69}.route-metrics small{font-size:8px;color:#677c8c;text-transform:uppercase;letter-spacing:.07em}
        a{color:#075c86;overflow-wrap:anywhere}.map-image{width:100%;max-height:420px;object-fit:contain;border:1px solid #d4e2ef}figcaption{font-size:9px;color:#66788b;margin-top:4px}.imagery-table{width:100%;border-collapse:collapse;font-size:9px}.imagery-table th,.imagery-table td{border:1px solid #d4e2ef;padding:6px;text-align:left;vertical-align:top}.imagery-table th{background:#edf3f6;color:#38516a}
        .footer{margin-top:22px;border-top:1px solid #ccd7e0;padding-top:8px;font-size:9px;color:#61717e}@media print{body{margin:0 auto;padding:0 8px}.masthead{margin:0 -8px 14px}.incident,section.cluster{break-inside:avoid}figure{break-inside:avoid}}
      </style></head><body><header class="masthead"><div class="brandline"><span class="brand">NDRF · Disaster Response Command Center</span><span class="prototype">AUTHORIZED PROTOTYPE ENVIRONMENT</span></div><h1>Incident response report</h1><div class="brandline">Generated ${escapeHtml(new Date().toLocaleString())} · ${escapeHtml(detail.code)} · ${escapeHtml(detail.mode === "live" ? "Live Copernicus EMS" : "Demo / historical")}</div></header>
      <div class="incident"><b>${escapeHtml(detail.name)}</b><br>${escapeHtml(detail.category)} · ${escapeHtml(detail.state || detail.countries.join(", "))}<p>${escapeHtml(shortDescription)}</p><b>Main affected region:</b> ${escapeHtml(mainCoordinates)}<br><b>Source:</b> ${escapeHtml(detail.source)} · Updated ${escapeHtml(detail.relativeUpdate || detail.lastUpdate || "time unavailable")}</div>
      <h2>Affected region</h2><p>${detail.affectedAreaKm2 == null ? "Affected area size unavailable" : `${detail.affectedAreaKm2} km²`} · ${escapeHtml(detail.state || detail.countries.join(", "))}</p>${mapSection}<ul>${affectedZones || "<li>Boundary coordinates unavailable.</li>"}</ul>
      <h2>Satellite acquisitions</h2><p class="muted">Source acquisition metadata from Copernicus EMS. The map snapshot uses the configured satellite basemap and response overlays.</p>${imageryContent}${imageSource}
      <h2>Nearest cluster routes</h2><p class="muted">Each recommendation is the closest validated road route returned for its cluster. Travel times are estimates without live traffic. Hospital capacity and operations require field confirmation.</p>${clusterContent || "<p class=\"muted\">No cluster route data is currently available.</p>"}
      <div class="footer">Prototype operational reference. Confirm current roads, facility status, and route safety before dispatch.</div></body></html>`;
    const reportDocument = reportFrame.contentDocument;
    const reportWindow = reportFrame.contentWindow;
    if (!reportDocument || !reportWindow) {
      cleanupReportFrame();
      setReportError("The response report could not be opened for printing.");
      return;
    }

    try {
      reportWindow.addEventListener("afterprint", cleanupReportFrame, { once: true });
      reportDocument.open();
      reportDocument.write(reportHtml);
      reportDocument.close();
      reportWindow.focus();
      reportWindow.print();
    } catch (error) {
      cleanupReportFrame();
      console.error("Unable to print the response report", error);
      setReportError("The response report could not be printed. Try again or check your browser's print settings.");
    }
  }

  const impact = detail?.impact || {};
  const fireN = facilities.filter((f) => f.type === "fire_station").length;
  const ambN = facilities.filter((f) => f.type === "ambulance").length;
  const selectedRoute = clusterRoutes
    .flatMap((cluster) => cluster.hospitalRoutes.map((route) => ({ cluster, route })))
    .find(({ route }) => route.id === selectedRouteId);

  function selectCluster(id: string) {
    setSelectedClusterId(id);
    setExpandedClusterIds((previous) => previous.includes(id) ? previous : [...previous, id]);
    const route = clusterRoutes.find((cluster) => cluster.id === id)?.hospitalRoutes[0];
    setSelectedRouteId(route?.id || null);
    setHospitalId(route?.hospital.id || null);
  }

  function selectRoute(id: string) {
    const match = clusterRoutes
      .flatMap((cluster) => cluster.hospitalRoutes.map((route) => ({ cluster, route })))
      .find(({ route }) => route.id === id);
    if (!match) return;
    setSelectedClusterId(match.cluster.id);
    setSelectedRouteId(match.route.id);
    setHospitalId(match.route.hospital.id);
  }

  function selectHospital(id: string) {
    setHospitalId(id);
    const matches = clusterRoutes
      .flatMap((cluster) => cluster.hospitalRoutes.map((route) => ({ cluster, route })));
    const match = matches.find(
      ({ cluster, route }) => route.hospital.id === id && cluster.id === selectedClusterId
    ) || matches.find(({ route }) => route.hospital.id === id);
    if (match) {
      setSelectedClusterId(match.cluster.id);
      setExpandedClusterIds((previous) =>
        previous.includes(match.cluster.id) ? previous : [...previous, match.cluster.id]
      );
      setSelectedRouteId(match.route.id);
    }
  }

  function selectZone(id: string) {
    const cluster = clusterRoutes.find((item) => item.parentZoneId === id);
    if (cluster) selectCluster(cluster.id);
  }

  function selectFacility(id: string) {
    const facility = facilities.find((item) => item.id === id);
    if (facility) setSelectedFacility(facility);
  }

  return (
    <div className="dashboard-shell flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar
        clock={clock}
        mode={mode}
        onMode={(m) => {
          setSelectedId(null);
          setDetail(null);
          setMode(m);
        }}
        liveIndia={liveIndia}
        isRefreshing={isRefreshing}
        onRefresh={() => setRefreshSequence((sequence) => sequence + 1)}
        operatorEmail={operatorEmail}
        onLogout={onLogout}
      />
      {(loadError || notice) && (
        <div
          role={loadError ? "alert" : "status"}
          className={`border-b px-4 py-1 text-[11px] sm:px-6 ${loadError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-sky-100 bg-sky-50/80 text-sky-800"}`}
        >
          {loadError || notice}
        </div>
      )}
      {hospitalDataNotice && (
        <p className="mb-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-2 py-1.5 text-[9px] text-amber-200">
          Facility provenance: {hospitalDataNotice}
        </p>
      )}

      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-slate-800 bg-slate-800 sm:grid-cols-5">
        {[
          ["Active incidents", String(list.filter((item) => !item.closed).length)],
          ["Affected clusters", String(clusterRoutes.length)],
          ["Hospitals identified", String(new Set(clusterRoutes.flatMap((cluster) => cluster.hospitalRoutes.map((route) => route.hospital.id))).size)],
          ["Validated routes", String(clusterRoutes.reduce((count, cluster) => count + cluster.hospitalRoutes.length, 0))],
          ["Unresolved clusters", String(clusterRoutes.filter((cluster) => !cluster.hospitalRoutes.length).length)],
        ].map(([label, value]) => (
          <div key={label} className="bg-ink-900 px-3 py-2 sm:px-4">
            <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_390px] lg:overflow-hidden">
        <aside className="dashboard-sidebar flex min-h-[330px] flex-col border-b lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Incidents</h2>
                <p className="mt-0.5 text-xs text-slate-500">{filtered.length} activations</p>
              </div>
            </div>
            <input
              type="search"
              aria-label="Search incidents"
              placeholder="Search incidents…"
              value={incidentQuery}
              onChange={(event) => setIncidentQuery(event.target.value)}
              className="mt-3 h-9 w-full rounded-md border border-slate-700 bg-ink-950 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                aria-label="Filter incidents by state or union territory"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="h-8 min-w-0 rounded-md border border-slate-700 bg-ink-950 px-2 text-[10px] text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state === "all" ? "All states & UTs" : state}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter incidents by severity"
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value)}
                className="h-8 min-w-0 rounded-md border border-slate-700 bg-ink-950 px-2 text-[10px] capitalize text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {["all", "critical", "high", "moderate", "low"].map((severity) => (
                  <option key={severity} value={severity}>{severity === "all" ? "All severity" : severity}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {incidentGroups.map(([state, items]) => (
              <section key={state} className="mb-4">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{state}</h3>
                  <span className="text-[10px] text-slate-400">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                        selectedId === item.id
                          ? "border-sky-300 bg-sky-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-slate-400">{item.code}</span>
                        <span className="flex items-center gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${
                            item.severity === "critical"
                              ? "border border-rose-400/30 bg-rose-500/10 text-rose-300"
                              : item.severity === "high"
                                ? "border border-amber-400/30 bg-amber-500/10 text-amber-200"
                                : "border border-cyan-400/20 bg-cyan-400/5 text-cyan-200"
                          }`}>
                            {item.severity}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${item.closed ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
                            {item.closed ? "Closed" : "Open"}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 text-[13px] font-medium leading-snug text-slate-900">{item.name}</div>
                      <div className="mt-1.5 text-[11px] text-slate-500">
                        {item.category} · {item.mode === "live" ? "Copernicus live" : "Historical"}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!filtered.length && (
              <p className="px-2 py-8 text-center text-xs text-slate-500">No incidents for this state.</p>
            )}
          </div>
        </aside>

        <section className="relative min-h-[420px] overflow-hidden border-b border-sky-200/10 bg-ink-950 lg:min-h-0 lg:border-b-0">
          <DisasterMap
            disaster={detail}
            hospitals={hospitals}
            facilities={facilities}
            layers={layers}
            selectedHospitalId={hospitalId}
            selectedClusterId={selectedClusterId}
            selectedRouteId={selectedRouteId}
            clusterRoutes={clusterRoutes}
            onSelectHospital={selectHospital}
            onSelectCluster={selectCluster}
            onSelectRoute={selectRoute}
            onSelectZone={selectZone}
            onSelectFacility={selectFacility}
            onSnapshotReady={(getSnapshot) => {
              mapSnapshotRef.current = getSnapshot;
            }}
          />
          <CollapsibleSection
            title="MAP LAYERS"
            icon={Layers}
            className="glass-panel absolute left-3 top-3 z-10 w-60 rounded-2xl border p-3 shadow-panel"
            contentClassName="mt-2"
          >
              {Object.entries({
                imagery: "Satellite imagery",
                aoi: "Affected area",
                clusters: "Affected clusters",
                hospitals: "Hospitals",
                infrastructure: "Emergency facilities",
                routes: "Cluster → hospital routes",
              }).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between py-0.5 text-[11px] text-slate-300">
                  {label}
                  <input
                    type="checkbox"
                    checked={layers[k]}
                    onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
                  />
                </label>
              ))}
              <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[10px] text-slate-400">
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full border border-sky-200 bg-sky-400/40" /> Parent affected zone</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full border border-white bg-sky-500" /> Numbered child cluster</div>
                <div className="flex items-center gap-2"><span aria-hidden="true">🏥</span><span className="h-2 w-2 rounded-full bg-cyan-400" /> Hospital · status unknown</div>
                <div className="pl-5 text-[9px] text-slate-500">Green available · amber limited · red high load when source data confirms</div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 bg-sky-400" /> Recommended route (cluster colour)</div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 bg-amber-400" /> Alternative road route</div>
                <div className="flex items-center gap-2"><span aria-hidden="true">🔥</span><span className="h-2 w-2 rounded-full bg-orange-400" /> Fire station</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-saffron" /> NDRF</div>
              </div>
          </CollapsibleSection>
          {loading && (
            <div className="absolute right-3 top-3 rounded-md border border-white/70 bg-white/85 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-xl">
              Loading response layers…
            </div>
          )}
        </section>

        <aside className="dashboard-sidebar flex min-h-[440px] flex-col overflow-y-auto border-slate-200 lg:min-h-0 lg:border-l">
          {detail ? (
            <>
              <CollapsibleSection
                title="INCIDENT BRIEF"
                defaultOpen
                className="border-b border-slate-200 p-4"
                contentClassName="mt-3"
              >
                <h2 className="text-base font-semibold leading-tight text-slate-900">{detail.name}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.category}{detail.subCategory ? ` · ${detail.subCategory}` : ""}
                  {" · "}{detail.state || detail.countries.join(", ")}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {(detail.reason || "No short incident summary supplied by the source.").slice(0, 260)}
                  {(detail.reason || "").length > 260 ? "…" : ""}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Stat icon={MapPinned} label="Affected area" value={`${detail.affectedAreaKm2 ?? "—"} km²`} />
                  <Stat icon={Users} label="Est. population" value={formatNum(impact.populationEstimated)} />
                </div>
                {detail.imagery?.length ? (
                  <a
                    href={safeHttpsUrl(detail.productsPath) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 ${detail.productsPath ? "" : "pointer-events-none opacity-50"}`}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {detail.imagery.length} source image acquisitions
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </CollapsibleSection>

              <CollapsibleSection
                title="AREA CLUSTERS & NEAREST HOSPITAL ROUTES"
                icon={MapPinned}
                defaultOpen
                className="border-b border-slate-200 p-4"
                contentClassName="mt-2"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] text-slate-500">
                    {clusterRoutes.length} affected-area clusters · approx. {CLUSTER_CONFIG.radiusKm} km radius
                  </p>
                  {clusterRoutesLoading && <span className="text-[10px] font-medium text-sky-700">Finding routes…</span>}
                </div>
                {clusterRoutesError && (
                  <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
                    <span>{clusterRoutesError}</span>
                    <button
                      type="button"
                      disabled={clusterRoutesLoading}
                      onClick={() => setClusterRetrySequence((sequence) => sequence + 1)}
                      className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {routeMatrixError && (
                  <p className="mb-2 text-[10px] text-amber-300">
                    Road matrix unavailable; only directly validated road routes are eligible. {routeMatrixError}
                  </p>
                )}
                <label className="mb-2 flex items-center gap-2 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={routingDebug}
                    onChange={(event) => setRoutingDebug(event.target.checked)}
                  />
                  Include candidate and rejected-route diagnostics
                </label>
                <div className="space-y-1.5">
                  {clusterRoutes.map((cluster) => (
                    <details
                      key={cluster.id}
                      open={expandedClusterIds.includes(cluster.id)}
                      className={`route-card overflow-hidden rounded-lg border ${cluster.id === selectedClusterId ? "border-sky-300 bg-sky-50 shadow-sm" : "border-slate-200 bg-white"}`}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setExpandedClusterIds((previous) =>
                          isOpen
                            ? previous.includes(cluster.id) ? previous : [...previous, cluster.id]
                            : previous.filter((id) => id !== cluster.id)
                        );
                        if (isOpen) selectCluster(cluster.id);
                      }}
                    >
                      <summary
                        className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] [&::-webkit-details-marker]:hidden"
                      >
                        <span className="min-w-0">
                          <span className="mr-1.5 font-mono text-sky-700">{cluster.id}</span>
                          <span className="truncate text-slate-800">{cluster.parentZoneName}</span>
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-400">{cluster.hospitalRoutes.length} hospitals</span>
                      </summary>
                      <div data-collapsible-content className="space-y-2 border-t border-slate-100 px-3 py-3">
                        <p className="text-[9px] text-slate-500">
                          {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
                          {cluster.areaKm2 == null ? " · area geometry estimated/unavailable" : ` · ${cluster.areaKm2} km²`}
                        </p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-slate-400">
                          <span>Severity: <b className="capitalize text-slate-200">{cluster.severity || detail.severity}</b> ({cluster.severityBasis || detail.severityBasis || "basis unavailable"})</span>
                          <span>Cluster population: <b className="text-slate-200">{formatNum(cluster.populationEstimate)}</b></span>
                          <span className="col-span-2">{cluster.populationEstimateMethod}</span>
                          {cluster.assignedHospitalId && (
                            <span className="col-span-2">Proposed hospital: {cluster.hospitalRoutes.find((route) => route.hospital.id === cluster.assignedHospitalId)?.hospital.name || cluster.assignedHospitalId} · availability unknown</span>
                          )}
                        </div>
                        {cluster.hospitalRoutes.map((route) => (
                          <div key={route.id}>
                            <button
                              onClick={() => selectRoute(route.id)}
                              className={`route-card w-full rounded-md border p-2.5 text-left ${route.id === selectedRouteId ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}
                            >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium text-slate-800">
                                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-100 font-mono text-[9px] text-sky-800">{route.rank}</span>
                                <span className="truncate">{route.rank === 1 ? "Recommended" : route.rank === 2 ? "Alternative" : "Additional"} · {route.hospital.name}</span>
                              </span>
                              <span className={`shrink-0 text-[9px] ${route.routeStatus === "routed" ? "text-sky-300" : "text-amber-700"}`}>
                                {route.routeStatus === "routed" ? "ROAD ROUTE" : "UNAVAILABLE"}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-slate-600">
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5">{route.roadKm == null ? "— km" : `${route.roadKm} km`}</span>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5">{route.durationMin == null ? "— min" : `${route.durationMin} min`}</span>
                              <span className="text-[9px] text-slate-500">road network</span>
                            </div>
                            <p className="mt-1 text-[9px] text-slate-400">
                              Score {route.score?.toFixed(2) ?? "—"} · time {route.scoreBreakdown?.travelTime ?? "—"} · distance {route.scoreBreakdown?.roadDistance ?? "—"} · severity {route.scoreBreakdown?.severity ?? "—"} · access {route.scoreBreakdown?.roadAccessibility ?? "—"} · capability {route.scoreBreakdown?.emergencyCapability ?? "—"} · availability {route.scoreBreakdown?.availability ?? "—"}
                            </p>
                            <p className="mt-0.5 text-[9px] text-slate-400">{route.selectionReason}</p>
                            </button>
                            <a
                              href={googleMapsDirectionsUrl(cluster, route.hospital)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 hover:text-sky-900"
                            >
                              <ExternalLink className="h-3 w-3" /> Route in Google Maps
                            </a>
                          </div>
                        ))}
                        {!cluster.hospitalRoutes.length && (
                          <p className="text-[10px] text-rose-300">Unresolved: {cluster.routingFailure || "no validated road route to a candidate hospital"}. Do not dispatch using a straight-line estimate.</p>
                        )}
                        {routingDebug && cluster.debug && (
                          <pre className="max-h-32 overflow-auto rounded-md border border-slate-700 bg-ink-950 p-2 text-[9px] text-slate-300">
                            {JSON.stringify(cluster.debug, null, 2)}
                          </pre>
                        )}
                      </div>
                    </details>
                  ))}
                  {!clusterRoutesLoading && !clusterRoutes.length && !clusterRoutesError && (
                    <p className="text-[10px] text-slate-500">No affected-area clusters are available.</p>
                  )}
                </div>
              </CollapsibleSection>

              {selectedRoute && (
                <CollapsibleSection
                  title="SELECTED ROUTE DETAILS"
                  icon={Route}
                  defaultOpen
                  className="border-b border-slate-200 p-4"
                  contentClassName="mt-2 space-y-1.5 text-[10px]"
                >
                    <DetailRow label="Cluster / parent" value={`${selectedRoute.cluster.name} (${selectedRoute.cluster.id}) / ${selectedRoute.cluster.parentZoneName}`} />
                    <DetailRow label="Cluster coordinates" value={`${selectedRoute.cluster.latitude.toFixed(5)}, ${selectedRoute.cluster.longitude.toFixed(5)}`} />
                    <DetailRow label="Hospital" value={selectedRoute.route.hospital.name} />
                    <DetailRow label="Road route" value={selectedRoute.route.routeStatus === "routed" ? selectedRoute.route.routeSource : "Unavailable — no straight-line route substituted"} />
                    <DetailRow label="Distance / ETA" value={`${selectedRoute.route.roadKm ?? "Unavailable"} km / ${selectedRoute.route.durationMin ?? "Unavailable"} min (estimated; no live traffic)`} />
                    <DetailRow label="Hospital capacity" value="Unknown — no live capacity feed" />
                    <DetailRow label="Road snap" value={`Origin ${selectedRoute.route.routeSnapDistanceKm?.origin ?? "—"} km · destination ${selectedRoute.route.routeSnapDistanceKm?.destination ?? "—"} km`} />
                    <a
                      href={googleMapsDirectionsUrl(selectedRoute.cluster, selectedRoute.route.hospital)}
                      target="_blank"
                      rel="noreferrer"
                      className="my-2 inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open route in Google Maps
                    </a>
                    <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 p-3">
                      <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-sky-800">Route directions</div>
                      {selectedRoute.route.routeDirections?.length ? (
                        <ol className="space-y-1.5">
                          {selectedRoute.route.routeDirections.map((step, index) => (
                            <li key={`${selectedRoute.route.id}-step-${index}`} className="flex gap-2 text-[10px] leading-relaxed text-slate-700">
                              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-sky-100 font-mono text-[8px] text-sky-800">{index + 1}</span>
                              <span>{step.instruction}<span className="text-slate-500">{step.distanceKm == null ? "" : ` · ${step.distanceKm} km`}{step.durationMin == null ? "" : ` · ${step.durationMin} min`}</span></span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-[10px] text-slate-500">{selectedRoute.route.routeStatus === "routed" ? "Turn-by-turn directions are not available from the routing provider." : "Road route unavailable. No straight-line substitute is shown."}</p>
                      )}
                    </div>
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="🏥 NEARBY HOSPITALS"
                icon={HospitalIcon}
                className="border-b border-slate-200 p-4"
                contentClassName="mt-2"
              >
                <p className="mb-2 text-[9px] text-slate-500">
                  General nearby facilities; route alternatives are ranked per cluster above. Capacity is not live.
                </p>
                <div className="space-y-2">
                  {hospitals.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => selectHospital(h.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                        hospitalId === h.id ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-start gap-1.5 text-[12px] font-medium text-slate-900"><span aria-hidden="true">🏥</span><span>{h.name}</span></div>
                          <div className="text-[10px] text-slate-400">
                            {h.district} · {h.category} · Emergency {h.emergency ? "yes" : "unspecified"}
                          </div>
                          <div className="mt-1 text-[9px] uppercase tracking-wide text-slate-500">{hospitalAvailabilityStatus(h)}</div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-sky-700">
                          {h.distanceKm} km
                          <div className="text-[10px] text-slate-400">geographic</div>
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Directory beds {h.beds ?? "Unknown"} · Live availability {h.bedsAvailability}
                      </div>
                    </button>
                  ))}
                  {!hospitals.length && <p className="text-xs text-slate-500">No directory hospitals in radius.</p>}
                </div>
              </CollapsibleSection>

              <div className="border-b border-slate-200 p-4">
                <button
                  onClick={generateReportPdf}
                  disabled={clusterRoutesLoading || Boolean(clusterRoutesError)}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-55"
                >
                  <FileText className="h-4 w-4" />
                  {clusterRoutesLoading ? "Preparing cluster routes…" : "Print / save response PDF"}
                </button>
                {reportError && <p role="status" className="mt-2 text-xs text-rose-700">{reportError}</p>}
              </div>

              <CollapsibleSection
                title="FIRE & AMBULANCE RESOURCES"
                icon={Siren}
                className="border-b border-slate-200 p-4"
                contentClassName="mt-3 space-y-2"
              >
                <div className="flex gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-orange-800"><Flame className="h-3 w-3" />{fireN} fire stations</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-sky-800"><Ambulance className="h-3 w-3" />{ambN} ambulance nodes</span>
                </div>
                {facilities.filter((facility) => facility.type === "fire_station" || facility.type === "ambulance").map((facility) => (
                  <button
                    key={facility.id}
                    type="button"
                    onClick={() => setSelectedFacility(facility)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${
                      selectedFacility?.id === facility.id ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <span aria-hidden="true" className="mt-0.5">{facility.type === "fire_station" ? "🔥" : "🚑"}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-800">{facility.name}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">{facility.district}, {facility.state}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">{facility.distanceKm} km</span>
                  </button>
                ))}
                {!facilities.some((facility) => facility.type === "fire_station" || facility.type === "ambulance") && (
                  <p className="text-xs text-slate-500">No fire or ambulance locations in the current search radius.</p>
                )}
              </CollapsibleSection>

              <CollapsibleSection
                title="SYSTEM SECURITY"
                icon={ShieldCheck}
                className="border-b border-slate-200 p-4"
                contentClassName="mt-2 space-y-1.5"
              >
                <DetailRow label="Authentication" value="Secure · server verified" />
                <DetailRow label="Session" value={`Active · ${operatorEmail}`} />
                <DetailRow label="Data channel" value={window.location.protocol === "https:" ? "HTTPS encrypted" : window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "Local HTTP · development" : "HTTP · not encrypted"} />
                <DetailRow label="Satellite layer" value={layers.imagery ? "Enabled in map" : "Disabled by operator"} />
                <DetailRow label="Routing engine" value={clusterRoutesLoading ? "Calculating routes" : clusterRoutesError ? "Unavailable" : clusterRoutes.length ? `${routingProvider.toUpperCase()} · ${clusterRoutes.reduce((count, cluster) => count + cluster.hospitalRoutes.length, 0)} validated routes${routeMatrixError ? " · matrix limited" : ""}` : "Awaiting incident"} />
                <DetailRow label="Hospital data" value={hospitals.length ? `${hospitals.length} directory records · live load unknown` : loading ? "Loading directory" : "No nearby records returned"} />
                <p className="pt-1 text-[9px] leading-relaxed text-slate-500">Prototype environment. No external government identity or operations network is connected.</p>
              </CollapsibleSection>
            </>
          ) : (
            <div className="p-6 text-sm text-slate-500">{loadError || "Select an incident."}</div>
          )}
        </aside>
      </div>

      {selectedFacility && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setSelectedFacility(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="facility-dialog-title"
            className="w-full max-w-md rounded-xl border border-white/70 bg-white/90 p-5 shadow-2xl backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-sky-700">
                  {selectedFacility.type.replaceAll("_", " ")}
                </p>
                <h2 id="facility-dialog-title" className="mt-1 text-lg font-semibold text-slate-950">
                  {selectedFacility.name}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close facility details"
                onClick={() => setSelectedFacility(null)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <DetailRow label="State / district" value={`${selectedFacility.state}, ${selectedFacility.district}`} />
              <DetailRow label="Distance" value={`${selectedFacility.distanceKm} km from incident`} />
              <DetailRow label="Coordinates" value={`${selectedFacility.latitude.toFixed(5)}, ${selectedFacility.longitude.toFixed(5)}`} />
              <DetailRow label="Operational status" value={selectedFacility.operationalStatus || "Not provided by source"} />
              <DetailRow label="Location source" value={selectedFacility.source} />
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${selectedFacility.latitude},${selectedFacility.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              <ExternalLink className="h-4 w-4" /> View location in Google Maps
            </a>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 font-mono text-sm text-slate-800">{value}</div>
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  icon: Icon,
  className = "",
  contentClassName = "",
  defaultOpen = false,
  trailing,
}: {
  title: string;
  children: ReactNode;
  icon?: typeof Layers;
  className?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
  trailing?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} className={className}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold tracking-wide text-slate-700 [&::-webkit-details-marker]:hidden">
        {Icon && <Icon className="h-3.5 w-3.5 text-sky-600" />}
        <span>{title}</span>
        {trailing}
        <ChevronDown className="map-layer-chevron ml-auto h-3.5 w-3.5 transition-transform" />
      </summary>
      <div data-collapsible-content className={contentClassName}>{children}</div>
    </details>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[102px_minmax(0,1fr)] gap-2 border-b border-slate-100 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-slate-700">{value}</span>
    </div>
  );
}
