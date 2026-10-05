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
  Users,
} from "lucide-react";
import DisasterMap from "./map/DisasterMap";
import { buildAffectedClusters } from "./map/clusterZones";
import TopBar from "./components/TopBar";
import {
  apiGet,
  apiPost,
  type DisasterDetail,
  type DisasterSummary,
  type ClusterRoute,
  type Facility,
  type Hospital,
} from "./services/api";
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

function formatNum(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "Unknown";
  return new Intl.NumberFormat("en-IN").format(n);
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

export default function App() {
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
  const [stateFilter, setStateFilter] = useState("all");
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
    () => buildAffectedClusters(parentZones, detail?.centroid, 12),
    [parentZones, detail?.centroid]
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
    }>(`/api/disasters/${selectedId}/cluster-routes`, {
      clusters: clusterOrigins,
    })
      .then((data) => {
        if (!cancel) {
          setClusterRoutes(data.clusters);
          setRoutingProvider(data.routingProvider?.provider || "OSRM");
          setRouteMatrixError(data.routeMatrixError || null);
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
          setClusterRoutesError("Cluster routing is temporarily unavailable.");
        }
      })
      .finally(() => {
        if (!cancel) setClusterRoutesLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [selectedId, clusterOrigins, detail, clusterRetrySequence]);

  const states = useMemo(() => {
    const additionalStates = list
      .map((item) => item.state || item.countries.join(", "))
      .filter((state) => state && !INDIA_STATES_AND_UTS.includes(state));
    return ["all", ...INDIA_STATES_AND_UTS, ...Array.from(new Set(additionalStates)).sort()];
  }, [list]);

  const filtered = list.filter((i) => {
    if (stateFilter !== "all" && (i.state || i.countries.join(", ")) !== stateFilter) return false;
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
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      setReportError("Allow pop-ups to generate the PDF report.");
      return;
    }
    setReportError(null);
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
        const steps = route.routeDirections?.length
          ? `<ol>${route.routeDirections.map((step) => `<li>${escapeHtml(step.instruction)}${step.distanceKm == null ? "" : ` · ${step.distanceKm} km`}${step.durationMin == null ? "" : ` · ${step.durationMin} min`}</li>`).join("")}</ol>`
          : `<p class="muted">${route.routeStatus === "routed" ? "Turn-by-turn directions were not provided by the routing service." : "Road route and directions unavailable."}</p>`;
        return `<article class="route"><h4>${route.rank === 1 ? "Nearest recommended route" : `Nearest alternative ${route.rank}`} · ${escapeHtml(route.hospital.name)}</h4><p><b>Road distance:</b> ${route.roadKm == null ? "Unavailable" : `${route.roadKm} km`} · <b>ETA:</b> ${route.durationMin == null ? "Unavailable" : `${route.durationMin} min`} · <b>Route status:</b> ${escapeHtml(route.routeStatus)}</p><p><b>Cluster origin:</b> ${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)} · <b>Hospital:</b> ${route.hospital.latitude.toFixed(5)}, ${route.hospital.longitude.toFixed(5)}</p><p class="muted">${escapeHtml(route.selectionReason)}</p><p><a href="${escapeHtml(mapsUrl)}">Open this cluster-to-hospital route in Google Maps</a></p><h5>Road directions</h5>${steps}</article>`;
      }).join("");
      return `<section><h3>${escapeHtml(cluster.name)} <span class="muted">· ${escapeHtml(cluster.id)}</span></h3><p><b>Parent affected zone:</b> ${escapeHtml(cluster.parentZoneName)} (${escapeHtml(cluster.parentZoneId)}) · <b>Cluster coordinates:</b> ${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)} (latitude, longitude)${cluster.areaKm2 == null ? "" : ` · <b>Area:</b> ${cluster.areaKm2} km²`}</p>${routeContent || '<p class="muted">No suitable hospital routes are available for this cluster.</p>'}</section>`;
    }).join("");
    const imagery = detail.imagery || [];
    const imageryContent = imagery.length
      ? `<ul>${imagery.map((image) => `<li><b>${escapeHtml(image.sensorName || image.sensorType || "Satellite acquisition")}</b> · ${escapeHtml(image.aoiName || "AOI")} · ${escapeHtml(image.productType || "Product")} · ${escapeHtml(image.resolutionClass || "resolution not listed")} · ${escapeHtml(image.acquisitionTime || "Acquisition time unavailable")}${image.fileName ? `<br><span class="muted">${escapeHtml(image.fileName)}</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="muted">No source image acquisitions were listed for this activation.</p>`;
    const productArchive = safeHttpsUrl(detail.productsPath);
    const imageSource = productArchive
      ? `<p><a href="${escapeHtml(productArchive)}">Open official Copernicus EMS product archive (source imagery and mapping products)</a></p>`
      : `<p class="muted">No downloadable product archive was provided by the source activation.</p>`;
    const mapSection = mapSnapshot
      ? `<figure><img class="map-image" src="${mapSnapshot}" alt="Satellite basemap with affected clusters and hospital routes"><figcaption>Current satellite basemap with affected-area clusters and routed hospital links. Imagery tiles © Esri and contributors.</figcaption></figure>`
      : `<p class="muted">Map snapshot could not be captured in this browser. Use the Google Maps route links below for navigation.</p>`;
    const shortDescription = (detail.reason || "No short incident summary supplied by the source.").slice(0, 360);
    const reportHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Disaster response routing report · ${escapeHtml(detail.code)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap"><style>
      *{box-sizing:border-box}body{font:14px/1.55 "Montserrat",Arial,sans-serif;color:#14243a;margin:36px auto;max-width:900px;padding:0 28px}h1{font-size:24px;margin:0 0 5px;color:#12345a}h2{font-size:17px;margin:25px 0 8px;border-bottom:1px solid #cbd9e8;padding-bottom:6px}h3{font-size:15px;margin:0 0 8px;color:#125ca1}h4{margin:12px 0 5px;color:#1269b5}h5{margin:8px 0 4px}.sub,.muted{color:#5d6f83;font-size:12px}.box{border:1px solid #d4e2ef;border-radius:10px;padding:14px 16px;margin-top:12px;background:#f5f9fd}section{break-inside:avoid;border:1px solid #d8e4ef;border-radius:10px;padding:14px 16px;margin:12px 0}.route{border-left:3px solid #3186d8;padding:2px 0 2px 13px;margin:13px 0}ol{padding-left:22px;margin:6px 0}li{margin:4px 0}a{color:#075ea8;overflow-wrap:anywhere}.map-image{width:100%;max-height:480px;object-fit:contain;border:1px solid #d4e2ef;border-radius:8px}figcaption{font-size:11px;color:#66788b;margin-top:5px}.footer{margin-top:30px;border-top:1px solid #d7e1eb;padding-top:10px;font-size:11px;color:#66788b}@media print{body{margin:0 auto;padding:0 12px}.box,section{background:#fff;break-inside:avoid}figure{break-inside:avoid}}
    </style></head><body><h1>Disaster response · cluster routing report</h1><div class="sub">Generated ${escapeHtml(new Date().toLocaleString())} · Incident ${escapeHtml(detail.code)} · ${escapeHtml(detail.mode === "live" ? "Live Copernicus EMS" : "Demo / historical")}</div><div class="box"><b>${escapeHtml(detail.name)}</b><br>${escapeHtml(detail.category)} · ${escapeHtml(detail.state || detail.countries.join(", "))}<p>${escapeHtml(shortDescription)}</p><b>Main affected region:</b> ${escapeHtml(mainCoordinates)}<br><b>Source:</b> ${escapeHtml(detail.source)} · Updated ${escapeHtml(detail.relativeUpdate || detail.lastUpdate || "time unavailable")}</div><h2>Affected region and map</h2><p>${detail.affectedAreaKm2 == null ? "Affected area size unavailable" : `${detail.affectedAreaKm2} km²`} · ${escapeHtml(detail.state || detail.countries.join(", "))}</p>${mapSection}<ul>${affectedZones || "<li>Boundary coordinates unavailable.</li>"}</ul><h2>Satellite image acquisitions</h2><p class="muted">Source image metadata supplied by Copernicus EMS. The source imagery and mapping products are available in the linked official archive.</p>${imageryContent}${imageSource}<h2>Cluster-to-hospital routes</h2><p class="muted">Road-network results from ${escapeHtml(routingProvider.toUpperCase())}. The Google Maps link in every route opens its own cluster origin and destination. Distances and ETAs may not reflect live traffic or closures.</p>${clusterContent || "<p>No cluster route data is currently available.</p>"}<div class="footer">Operational reference only. Verify current road conditions, hospital operations, and route safety before dispatch.</div><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script></body></html>`;
    reportWindow.document.open();
    reportWindow.document.write(reportHtml);
    reportWindow.document.close();
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
      />
      {(loadError || notice) && (
        <div
          role={loadError ? "alert" : "status"}
          className={`border-b px-4 py-1 text-[11px] sm:px-6 ${loadError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-sky-100 bg-sky-50/80 text-sky-800"}`}
        >
          {loadError || notice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:overflow-hidden">
        <aside className="dashboard-sidebar flex min-h-[330px] flex-col border-b lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Incidents</h2>
                <p className="mt-0.5 text-xs text-slate-500">{filtered.length} activations</p>
              </div>
              <select
                aria-label="Filter incidents by state or union territory"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="h-9 max-w-[150px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state === "all" ? "All states & UTs" : state}
                  </option>
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
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${item.closed ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
                          {item.closed ? "Closed" : "Open"}
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
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-400" /> Hospital</div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 bg-sky-400" /> Recommended route (cluster colour)</div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 bg-amber-400" /> Alternative road route</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-400" /> Fire</div>
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
                    {clusterRoutes.length} source-AOI clusters · cells up to 0.56 km²
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
                    Road-network ranking unavailable; geographic proximity is used. {routeMatrixError}
                  </p>
                )}
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
                              <span className={`shrink-0 text-[9px] ${route.routeStatus === "routed" ? "text-emerald-700" : "text-amber-700"}`}>
                                {route.routeStatus === "routed" ? "ROUTED" : "UNAVAILABLE"}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-slate-600">
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5">{route.roadKm == null ? "— km" : `${route.roadKm} km`}</span>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5">{route.durationMin == null ? "— min" : `${route.durationMin} min`}</span>
                              <span className="text-[9px] text-slate-500">road network</span>
                            </div>
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
                          <p className="text-[10px] text-slate-500">No suitable hospitals found within 120 km.</p>
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
                    <DetailRow label="Distance / ETA" value={`${selectedRoute.route.roadKm ?? "Unavailable"} km / ${selectedRoute.route.durationMin ?? "Unavailable"} min`} />
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
                title="HOSPITAL DETAILS · NEARBY DIRECTORY"
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
                          <div className="text-[12px] font-medium text-slate-900">{h.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {h.district} · {h.category} · Emergency {h.emergency ? "yes" : "unspecified"}
                          </div>
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
                  {clusterRoutesLoading ? "Preparing cluster routes…" : "Export response report"}
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
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-800">{facility.name}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">{facility.district}, {facility.state}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">{facility.distanceKm} km</span>
                  </button>
                ))}
                {!facilities.some((facility) => facility.type === "fire_station" || facility.type === "ambulance") && (
                  <p className="text-xs text-slate-500">No fire or ambulance locations in the current search radius.</p>
                )}
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
