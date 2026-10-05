import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  ChevronDown,
  FileText,
  Flame,
  Hospital as HospitalIcon,
  Layers,
  MapPinned,
  Route,
  Shield,
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

function severityColor(s: string) {
  if (s === "critical") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (s === "high") return "text-orange-300 bg-orange-500/10 border-orange-500/30";
  return "text-amber-200 bg-amber-500/10 border-amber-500/30";
}

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

function getConfidence(detail: DisasterDetail | DisasterSummary) {
  const updatedAt = detail.lastUpdate || detail.activationTime || detail.eventTime;
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageHours = Number.isFinite(updatedAtMs) ? Math.max(0, (Date.now() - updatedAtMs) / 36e5) : Infinity;
  const recency = ageHours <= 24 ? 100 : ageHours <= 24 * 7 ? 80 : ageHours <= 24 * 30 ? 55 : 20;
  const hasGeometry = "extentGeoJSON" in detail && Boolean(detail.extentGeoJSON);
  const knownSeverity = ["critical", "high", "moderate"].includes(detail.severity);
  const severitySignal = knownSeverity ? 75 : 25;
  const sourceAgreement = detail.source ? 50 : 0;
  const reliability = detail.mode === "live" ? 80 : 35;
  const location = detail.centroid && hasGeometry ? 85 : detail.centroid || hasGeometry ? 60 : 20;
  const sourceAgreementDetail = detail.source
    ? "One declared source; independent source corroboration is not reported. Neutral midpoint used."
    : "No source agreement evidence is available.";
  const factors = [
    { label: "Data reliability", value: reliability, detail: detail.mode === "live" ? "Live Copernicus EMS source; imagery/product verification is not independently assessed" : "Demonstration / historical record, not a live report" },
    { label: "Severity classification", value: severitySignal, detail: knownSeverity ? `A ${detail.severity} category is recorded; severity is not itself proof of accuracy` : "Severity is not classified" },
    { label: "Source agreement", value: sourceAgreement, detail: sourceAgreementDetail },
    { label: "Location accuracy", value: location, detail: detail.centroid && hasGeometry ? "Centroid and affected-area boundary are present; source positional accuracy is not reported" : "Only partial location geometry is available" },
    { label: "Information recency", value: recency, detail: Number.isFinite(updatedAtMs) ? `Based on ${new Date(updatedAtMs).toLocaleDateString()}` : "No valid update timestamp is available" },
  ];
  const score = Math.round(
    factors[0].value * 0.25 +
      factors[1].value * 0.15 +
      factors[2].value * 0.2 +
      factors[3].value * 0.2 +
      factors[4].value * 0.2
  );
  return { score, factors };
}

export default function App() {
  const [clock, setClock] = useState("");
  const [mode, setMode] = useState("india");
  const [list, setList] = useState<DisasterSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveIndia, setLiveIndia] = useState(0);
  const [cemsFresh, setCemsFresh] = useState("");
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
  const [routingGeneratedAt, setRoutingGeneratedAt] = useState<string | null>(null);
  const [routingProvider, setRoutingProvider] = useState<string>("OSRM");
  const [routeMatrixStatus, setRouteMatrixStatus] = useState<string>("pending");
  const [routeMatrixError, setRouteMatrixError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Record<string, { source: string; updated?: string; fetchedAt?: string | null; tier?: string; relative?: string }>>({});

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-IN", {
          hour12: false,
          timeZone: "Asia/Kolkata",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const data = await apiGet<{
        items: DisasterSummary[];
        notice: string;
        liveIndiaCount: number;
        copernicusFetchedAt: string | null;
      }>(`/api/disasters?mode=${mode}`);
      if (cancel) return;
      setList(data.items);
      setNotice(data.notice);
      setLiveIndia(data.liveIndiaCount);
      setCemsFresh(data.copernicusFetchedAt ? new Date(data.copernicusFetchedAt).toLocaleTimeString("en-IN") : "pending");
      if (!selectedId && data.items[0]) setSelectedId(data.items[0].id);
    })().catch(() => undefined);
    apiGet<Record<string, { source: string; updated?: string; fetchedAt?: string | null; tier?: string; relative?: string }>>(
      "/api/freshness"
    ).then(setFreshness).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [mode]);

  useEffect(() => {
    if (!selectedId) return;
    let cancel = false;
    setLoading(true);
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
      .catch(() => undefined)
      .finally(() => setLoading(false));
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
    () => buildAffectedClusters(parentZones, detail?.centroid, 6),
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
    setRouteMatrixStatus("pending");
    setRouteMatrixError(null);
    setRoutingGeneratedAt(null);
    setClusterRoutesLoading(true);
    apiPost<{
      clusters: ClusterRoute[];
      generatedAt: string;
      routingProvider?: { provider?: string };
      routeMatrixStatus?: string;
      routeMatrixError?: string | null;
    }>(`/api/disasters/${selectedId}/cluster-routes`, {
      clusters: clusterOrigins,
      confidenceScore: detail ? getConfidence(detail).score : null,
    })
      .then((data) => {
        if (!cancel) {
          setClusterRoutes(data.clusters);
          setRoutingGeneratedAt(data.generatedAt);
          setRoutingProvider(data.routingProvider?.provider || "OSRM");
          setRouteMatrixStatus(data.routeMatrixStatus || "unavailable");
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
          setClusterRoutesError("Cluster-route service is unavailable. Restart the API to enable per-cluster routing.");
        }
      })
      .finally(() => {
        if (!cancel) setClusterRoutesLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [selectedId, clusterOrigins, detail]);

  const states = useMemo(
    () => ["all", ...Array.from(new Set(list.map((i) => i.state).filter(Boolean))) as string[]],
    [list]
  );
  const categories = useMemo(
    () => ["all", ...Array.from(new Set(list.map((i) => i.category)))],
    [list]
  );

  const filtered = list.filter((i) => {
    if (category !== "all" && i.category !== category) return false;
    if (severity !== "all" && i.severity !== severity) return false;
    if (stateFilter !== "all" && i.state !== stateFilter) return false;
    return true;
  });

  const counts = {
    critical: list.filter((i) => i.severity === "critical").length,
    high: list.filter((i) => i.severity === "high").length,
    moderate: list.filter((i) => i.severity === "moderate").length,
  };

  function generateReportPdf() {
    if (!detail) return;
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      setReportError("Allow pop-ups to generate the PDF report.");
      return;
    }
    setReportError(null);
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
        const steps = route.routeDirections?.length
          ? `<ol>${route.routeDirections.map((step) => `<li>${escapeHtml(step.instruction)}${step.distanceKm == null ? "" : ` · ${step.distanceKm} km`}${step.durationMin == null ? "" : ` · ${step.durationMin} min`}</li>`).join("")}</ol>`
          : `<p class="muted">${route.routeStatus === "routed" ? "Turn-by-turn directions were not provided by the routing service." : "Road route and directions unavailable."}</p>`;
        return `<article class="route"><h4>${route.rank === 1 ? "Recommended" : "Alternative"} · ${escapeHtml(route.hospital.name)}</h4><p><b>Status:</b> ${escapeHtml(route.routeStatus)} · <b>Distance:</b> ${route.roadKm == null ? "Unavailable" : `${route.roadKm} km`} · <b>ETA:</b> ${route.durationMin == null ? "Unavailable" : `${route.durationMin} min`}</p><p><b>Cluster origin:</b> ${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)} · <b>Hospital:</b> ${route.hospital.latitude.toFixed(5)}, ${route.hospital.longitude.toFixed(5)} (latitude, longitude)</p><p class="muted">${escapeHtml(route.selectionReason)}</p><h5>Road directions</h5>${steps}</article>`;
      }).join("");
      return `<section><h3>${escapeHtml(cluster.name)} <span class="muted">· ${escapeHtml(cluster.id)}</span></h3><p><b>Parent affected zone:</b> ${escapeHtml(cluster.parentZoneName)} (${escapeHtml(cluster.parentZoneId)}) · <b>Cluster coordinates:</b> ${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)} (latitude, longitude)${cluster.areaKm2 == null ? "" : ` · <b>Area:</b> ${cluster.areaKm2} km²`}</p>${routeContent || '<p class="muted">No suitable hospital routes are available for this cluster.</p>'}</section>`;
    }).join("");
    const reportHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Disaster response routing report · ${escapeHtml(detail.code)}</title><style>
      *{box-sizing:border-box}body{font:14px/1.55 Arial,sans-serif;color:#14243a;margin:36px auto;max-width:900px;padding:0 28px}h1{font-size:24px;margin:0 0 5px;color:#12345a}h2{font-size:17px;margin:25px 0 8px;border-bottom:1px solid #cbd9e8;padding-bottom:6px}h3{font-size:15px;margin:0 0 8px;color:#125ca1}h4{margin:12px 0 5px;color:#1269b5}h5{margin:8px 0 4px}.sub,.muted{color:#5d6f83;font-size:12px}.box{border:1px solid #d4e2ef;border-radius:10px;padding:14px 16px;margin-top:12px;background:#f5f9fd}section{break-inside:avoid;border:1px solid #d8e4ef;border-radius:10px;padding:14px 16px;margin:12px 0}.route{border-left:3px solid #3186d8;padding:2px 0 2px 13px;margin:13px 0}ol{padding-left:22px;margin:6px 0}li{margin:4px 0}.footer{margin-top:30px;border-top:1px solid #d7e1eb;padding-top:10px;font-size:11px;color:#66788b}@media print{body{margin:0 auto;padding:0 12px}.box,section{background:#fff;break-inside:avoid}button{display:none}}
    </style></head><body><h1>Disaster response · routing report</h1><div class="sub">Generated ${escapeHtml(new Date().toLocaleString())} · Incident ${escapeHtml(detail.code)}</div><div class="box"><b>${escapeHtml(detail.name)}</b><br>${escapeHtml(detail.category)} · Severity: ${escapeHtml(detail.severity)} · Confidence: ${getConfidence(detail).score}% (heuristic)<br><b>Main affected region coordinates:</b> ${escapeHtml(mainCoordinates)}<br><b>Data source:</b> ${escapeHtml(detail.source)} · Updated: ${escapeHtml(detail.relativeUpdate || detail.lastUpdate || "Timestamp unavailable")}</div><h2>Affected region</h2><p>${detail.affectedAreaKm2 == null ? "Affected area size unavailable" : `${detail.affectedAreaKm2} km²`} · ${escapeHtml(detail.state || detail.countries.join(", "))}</p><ul>${affectedZones || "<li>Boundary geometry unavailable.</li>"}</ul><h2>Cluster-to-hospital routes and directions</h2><p class="muted">Road-network results from ${escapeHtml(routingProvider.toUpperCase())}. Directions are included only when returned by the routing provider. Distances and ETAs may not reflect live traffic or closures.</p>${clusterContent || "<p>No cluster route data is currently available.</p>"}<div class="footer">Operational reference only. Verify current road conditions, hospital operations, and route safety before dispatch.</div><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script></body></html>`;
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

  return (
    <div className="dashboard-shell flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar
        clock={clock}
        mode={mode}
        onMode={(m) => {
          setSelectedId(null);
          setMode(m);
        }}
        liveIndia={liveIndia}
        notice={notice}
        freshness={cemsFresh}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:overflow-hidden">
        <aside className="dashboard-sidebar flex min-h-[330px] flex-col border-b border-sky-200/10 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-3 gap-2 p-3">
            {[
              ["critical", counts.critical, "Critical"],
              ["high", counts.high, "High"],
              ["moderate", counts.moderate, "Moderate"],
            ].map(([k, n, label]) => (
              <button
                key={k}
                onClick={() => setSeverity(severity === k ? "all" : String(k))}
                className={`rounded-lg border px-2 py-2 text-left ${severityColor(String(k))}`}
              >
                <div className="font-mono text-lg leading-none">{n as number}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider opacity-80">{label as string}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 px-3 pb-3">
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[11px]">
              {states.map((s) => (
                <option key={s} value={s}>{s === "all" ? "State" : s}</option>
              ))}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[11px]">
              {categories.map((s) => (
                <option key={s} value={s}>{s === "all" ? "Disaster" : s}</option>
              ))}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[11px]">
              <option value="all">Severity</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`mb-2 w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  selectedId === item.id
                    ? "border-sky-300/50 bg-sky-500/10 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.08)]"
                    : "border-sky-100/10 bg-slate-950/20 hover:border-sky-200/25 hover:bg-sky-500/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-slate-400">{item.code}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${severityColor(item.severity)}`}>
                    {item.severity}
                  </span>
                </div>
                <div className="mt-1 text-[13px] font-medium leading-snug text-white">{item.name}</div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{item.state || item.countries.join(", ")}</span>
                  <span className="uppercase">{item.mode} · {item.closed ? "closed" : "open"}</span>
                </div>
                <div className="mt-1 text-[9px] text-sky-300/80">
                  Estimated confidence · {getConfidence(item).score}%
                </div>
              </button>
            ))}
            {!filtered.length && (
              <p className="px-2 py-6 text-center text-xs text-slate-500">No incidents match filters.</p>
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
          />
          <CollapsibleSection
            title="MAP LAYERS"
            icon={Layers}
            defaultOpen
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
            <div className="absolute right-3 top-3 rounded-md border border-white/10 bg-ink-900/90 px-2 py-1 font-mono text-[10px] text-slate-300">
              FUSING LAYERS…
            </div>
          )}
        </section>

        <aside className="dashboard-sidebar flex min-h-[440px] flex-col overflow-y-auto border-sky-200/10 lg:min-h-0 lg:border-l">
          {detail ? (
            <>
              <CollapsibleSection
                title="DISASTER INFORMATION"
                defaultOpen
                className="border-b border-sky-100/10 p-4"
                contentClassName="border-t border-white/10 p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] text-slate-400">SELECTED INCIDENT</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${severityColor(detail.severity)}`}>
                    {detail.severity}
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-semibold leading-tight">{detail.name}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {detail.category}
                  {detail.subCategory ? ` · ${detail.subCategory}` : ""} · {detail.state || detail.countries.join(", ")}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{detail.reason}</p>
                {(() => {
                  const confidence = getConfidence(detail);
                  return (
                    <CollapsibleSection
                      title="DISASTER CONFIDENCE / AI CONFIDENCE"
                      trailing={<span className="font-mono text-sm font-semibold text-sky-300">{confidence.score}%</span>}
                      className="glass-panel mt-3 rounded-xl border p-3"
                      contentClassName="mt-2 space-y-2 border-t border-sky-400/10 pt-2"
                    >
                        {confidence.factors.map((factor) => (
                          <div key={factor.label}>
                            <div className="flex justify-between text-[10px] text-slate-300">
                              <span>{factor.label}</span><span className="font-mono">{factor.value}%</span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                              <div className="h-full rounded bg-sky-400" style={{ width: `${factor.value}%` }} />
                            </div>
                            <p className="mt-0.5 text-[9px] leading-snug text-slate-500">{factor.detail}</p>
                          </div>
                        ))}
                        <p className="text-[9px] leading-snug text-slate-500">
                          Weighted heuristic: reliability 25%, severity signal 15%, source agreement 20%, location 20%, recency 20%. Not a calibrated probability.
                        </p>
                    </CollapsibleSection>
                  );
                })()}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <Stat icon={MapPinned} label="Main coordinates" value={detail.centroid ? `${detail.centroid.latitude.toFixed(4)}, ${detail.centroid.longitude.toFixed(4)}` : "Unknown"} />
                  <Stat icon={MapPinned} label="Affected area" value={`${detail.affectedAreaKm2 ?? "Unknown"} km²`} />
                  <Stat icon={Users} label="Est. population" value={formatNum(impact.populationEstimated)} />
                  <Stat icon={Building2} label="Buildings affected" value={formatNum(impact.buildingsAffected)} />
                  <Stat icon={Route} label="Roads affected" value={impact.roadsAffectedKm != null ? `${impact.roadsAffectedKm} km` : "Unknown"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-400">
                  <span>Activation {detail.code}</span>
                  <span>·</span>
                  <span>{detail.mode === "live" ? "Copernicus EMS" : "Demo / historical"}</span>
                  <span>·</span>
                  <span>{detail.relativeUpdate}</span>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                title="AREA CLUSTERS → MULTIPLE HOSPITAL ROUTES"
                icon={MapPinned}
                defaultOpen
                className="border-b border-sky-100/10 p-4"
                contentClassName="mt-2"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] text-slate-500">
                    {clusterRoutes.length} sub-zones · multiple ranked hospital routes per cluster
                  </p>
                  {clusterRoutesLoading && <span className="font-mono text-[9px] text-sky-300">ROUTING…</span>}
                </div>
                {clusterRoutesError && (
                  <p className="mb-2 text-[10px] text-amber-300">Cluster routing unavailable: {clusterRoutesError}</p>
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
                      className={`route-card overflow-hidden rounded-xl border ${cluster.id === selectedClusterId ? "border-sky-400/45 shadow-[0_0_24px_rgba(14,165,233,0.08)]" : ""}`}
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
                          <span className="mr-1.5 font-mono text-sky-300">{cluster.id}</span>
                          <span className="truncate text-white">{cluster.parentZoneName}</span>
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-400">{cluster.hospitalRoutes.length} hospitals</span>
                      </summary>
                      <div data-collapsible-content className="space-y-2 border-t border-white/10 px-3 py-3">
                        <p className="text-[9px] text-slate-500">
                          {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
                          {cluster.areaKm2 == null ? " · area geometry estimated/unavailable" : ` · ${cluster.areaKm2} km²`}
                        </p>
                        {cluster.hospitalRoutes.map((route) => (
                          <button
                            key={route.id}
                            onClick={() => selectRoute(route.id)}
                            className={`route-card w-full rounded-lg border p-2.5 text-left ${route.id === selectedRouteId ? "border-sky-400/45 bg-sky-400/10 shadow-[0_0_18px_rgba(56,189,248,0.08)]" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium text-white">
                                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-400/15 font-mono text-[9px] text-sky-200">{route.rank}</span>
                                <span className="truncate">{route.rank === 1 ? "Recommended" : route.rank === 2 ? "Alternative" : "Additional"} · {route.hospital.name}</span>
                              </span>
                              <span className={`shrink-0 text-[9px] ${route.routeStatus === "routed" ? "text-emerald-300" : "text-amber-300"}`}>
                                {route.routeStatus === "routed" ? "ROAD ROUTED" : "ROUTE UNAVAILABLE"}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-slate-300">
                              <span className="rounded-md bg-white/5 px-1.5 py-0.5">{route.roadKm == null ? "— km" : `${route.roadKm} km`}</span>
                              <span className="rounded-md bg-white/5 px-1.5 py-0.5">{route.durationMin == null ? "— min" : `${route.durationMin} min`}</span>
                              <span className="text-[9px] text-slate-500">road network</span>
                            </div>
                          </button>
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
                {clusterRoutes.length > 0 && (
                  <p className="mt-2 text-[9px] leading-snug text-slate-500">
                    {clusterRoutes[0]?.hospitalRoutes[0]?.rankingBasis || "Hospitals are ranked on available accessibility information."}
                  </p>
                )}
              </CollapsibleSection>

              {selectedRoute && (
                <CollapsibleSection
                  title="SELECTED ROUTE DETAILS"
                  icon={Route}
                  defaultOpen
                  className="border-b border-sky-100/10 p-4"
                  contentClassName="mt-2 space-y-1.5 text-[10px]"
                >
                    <DetailRow label="Cluster / parent" value={`${selectedRoute.cluster.name} (${selectedRoute.cluster.id}) / ${selectedRoute.cluster.parentZoneName}`} />
                    <DetailRow label="Parent zone ID" value={selectedRoute.cluster.parentZoneId} />
                    <DetailRow label="Cluster coordinates" value={`${selectedRoute.cluster.latitude.toFixed(5)}, ${selectedRoute.cluster.longitude.toFixed(5)}`} />
                    <DetailRow label="Hospital" value={selectedRoute.route.hospital.name} />
                    <DetailRow label="Hospital coordinates" value={`${selectedRoute.route.hospital.latitude.toFixed(5)}, ${selectedRoute.route.hospital.longitude.toFixed(5)}`} />
                    <DetailRow label="Road route" value={selectedRoute.route.routeStatus === "routed" ? selectedRoute.route.routeSource : "Unavailable — no straight-line route substituted"} />
                    <DetailRow label="Distance / ETA" value={`${selectedRoute.route.roadKm ?? "Unavailable"} km / ${selectedRoute.route.durationMin ?? "Unavailable"} min`} />
                    <DetailRow label="Selection reason" value={selectedRoute.route.selectionReason} />
                    <DetailRow label="Hospital capacity" value={`${selectedRoute.route.hospital.beds ?? "Unknown"} listed beds · live occupancy unavailable`} />
                    <DetailRow label="Hospital data source" value={selectedRoute.route.hospital.source} />
                    <DetailRow label="Hospital source date" value={selectedRoute.route.hospital.sourceUpdated || "Not provided"} />
                    <DetailRow label="Routing updated" value={routingGeneratedAt ? new Date(routingGeneratedAt).toLocaleString() : "Timestamp unavailable"} />
                    <DetailRow label="Route provider" value={`${routingProvider.toUpperCase()} · ${routeMatrixStatus}`} />
                    <DetailRow label="Disaster / severity" value={`${detail.name} · ${detail.severity}`} />
                    <DetailRow label="Confidence" value={`${getConfidence(detail).score}% heuristic`} />
                    <DetailRow label="Data updated" value={detail.relativeUpdate || detail.lastUpdate || "Timestamp unavailable"} />
                    <div className="mt-3 rounded-xl border border-sky-200/10 bg-sky-400/[0.06] p-3">
                      <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-sky-200">Route directions · {selectedRoute.route.rank === 1 ? "Recommended" : "Alternative"}</div>
                      {selectedRoute.route.routeDirections?.length ? (
                        <ol className="space-y-1.5">
                          {selectedRoute.route.routeDirections.map((step, index) => (
                            <li key={`${selectedRoute.route.id}-step-${index}`} className="flex gap-2 text-[10px] leading-relaxed text-slate-200">
                              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-sky-300/15 font-mono text-[8px] text-sky-200">{index + 1}</span>
                              <span>{step.instruction}<span className="text-slate-500">{step.distanceKm == null ? "" : ` · ${step.distanceKm} km`}{step.durationMin == null ? "" : ` · ${step.durationMin} min`}</span></span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-[10px] text-slate-400">{selectedRoute.route.routeStatus === "routed" ? "Turn-by-turn directions are not available from the routing provider." : "Road route unavailable. No straight-line substitute is shown."}</p>
                      )}
                    </div>
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="HOSPITAL DETAILS · NEARBY DIRECTORY"
                icon={HospitalIcon}
                className="border-b border-sky-100/10 p-4"
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
                        hospitalId === h.id ? "border-teal-400/40 bg-teal-400/10" : "border-white/10 bg-ink-850"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[12px] font-medium text-white">{h.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {h.district} · {h.category} · Emergency {h.emergency ? "yes" : "unspecified"}
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-teal-300">
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

              <div className="border-b border-sky-100/10 p-4">
                <button
                  onClick={generateReportPdf}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-200/30 bg-gradient-to-r from-blue-600 to-sky-500 px-4 py-3 text-[11px] font-semibold tracking-[0.12em] text-white shadow-[0_8px_28px_rgba(14,116,220,0.22)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300/60"
                >
                  <FileText className="h-4 w-4" /> GENERATE REPORT PDF
                </button>
                {reportError && <p role="status" className="mt-2 text-[10px] text-amber-200">{reportError}</p>}
              </div>

              <CollapsibleSection
                title="RESPONSE RESOURCES"
                icon={Siren}
                className="border-b border-sky-100/10 p-4"
                contentClassName="mt-3"
              >
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl border border-sky-100/10 bg-sky-950/30 p-3">
                    <Flame className="mb-1.5 h-4 w-4 text-orange-300" />
                    <span className="text-slate-400">Fire stations</span><br /><span className="font-mono text-lg text-white">{fireN}</span>
                  </div>
                  <div className="rounded-xl border border-sky-100/10 bg-sky-950/30 p-3">
                    <Shield className="mb-1.5 h-4 w-4 text-sky-300" />
                    <span className="text-slate-400">Ambulance nodes</span><br /><span className="font-mono text-lg text-white">{ambN}</span>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Fused data reference only. Verify current availability before dispatch.
                </p>
              </CollapsibleSection>

              <CollapsibleSection
                title="DATA SOURCES · FRESHNESS"
                icon={Layers}
                className="p-4"
                contentClassName="mt-3 space-y-1.5 text-[10px] leading-relaxed text-slate-400"
              >
                <p>Copernicus EMS · {freshness.copernicus?.tier || "n/a"} · {freshness.copernicus?.relative || freshness.copernicus?.fetchedAt || "—"}</p>
                <p>Government of India hospital directory · directory date 01 Jun 2025 · not live occupancy</p>
                <p>OpenStreetMap facilities · 30 Sep 2026 compiled</p>
                <p>Routing engine {routingProvider.toUpperCase()} · {routeMatrixStatus === "road-network" ? "road network available" : routeMatrixStatus === "geographic-fallback" ? "geographic ranking only" : "status pending"} · no straight-line route substitutions</p>
              </CollapsibleSection>
            </>
          ) : (
            <div className="p-6 text-sm text-slate-500">Select an incident.</div>
          )}
        </aside>
      </div>

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
    <div className="rounded-xl border border-sky-100/10 bg-sky-950/30 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 font-mono text-sm text-white">{value}</div>
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
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold tracking-wider text-slate-300 [&::-webkit-details-marker]:hidden">
        {Icon && <Icon className="h-3.5 w-3.5 text-sky-400" />}
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
    <div className="grid grid-cols-[102px_minmax(0,1fr)] gap-2 border-b border-white/5 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-slate-200">{value}</span>
    </div>
  );
}
