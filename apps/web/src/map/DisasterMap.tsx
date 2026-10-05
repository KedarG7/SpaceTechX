import { useEffect, useRef } from "react";
import maplibregl, { Map, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ClusterRoute, DisasterDetail, Facility, Hospital } from "../services/api";

const TILE_URL =
  import.meta.env.VITE_SATELLITE_TILE_URL ||
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION ||
  "Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    satellite: {
      type: "raster",
      tiles: [TILE_URL],
      tileSize: 256,
      attribution: TILE_ATTRIBUTION,
    },
    fallback: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "base-background", type: "background", paint: { "background-color": "#101826" } },
    { id: "satellite-imagery", type: "raster", source: "satellite" },
    {
      id: "fallback-imagery",
      type: "raster",
      source: "fallback",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.92 },
    },
  ],
};

const FACILITY_COLOR: Record<string, string> = {
  fire_station: "#f97316",
  police: "#60a5fa",
  ambulance: "#f472b6",
  ndrf: "#FF9933",
  relief_centre: "#fbbf24",
  helipad: "#22d3ee",
  water: "#00cfff",
  power: "#facc15",
  government: "#c4b5fd",
};

type Props = {
  disaster?: DisasterDetail | null;
  hospitals: Hospital[];
  facilities: Facility[];
  layers: Record<string, boolean>;
  selectedHospitalId?: string | null;
  selectedClusterId?: string | null;
  selectedRouteId?: string | null;
  clusterRoutes: ClusterRoute[];
  onSelectHospital?: (id: string) => void;
  onSelectCluster?: (id: string) => void;
  onSelectRoute?: (id: string) => void;
  onSelectZone?: (id: string) => void;
  onSelectFacility?: (id: string) => void;
  onSnapshotReady?: (getSnapshot: () => string | null) => void;
};

export default function DisasterMap({
  disaster,
  hospitals,
  facilities,
  layers,
  selectedHospitalId,
  selectedClusterId,
  selectedRouteId,
  clusterRoutes,
  onSelectHospital,
  onSelectCluster,
  onSelectRoute,
  onSelectZone,
  onSelectFacility,
  onSnapshotReady,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const ready = useRef(false);
  const fallbackActive = useRef(false);
  const handlers = useRef({ onSelectHospital, onSelectCluster, onSelectRoute, onSelectZone, onSelectFacility });
  handlers.current = { onSelectHospital, onSelectCluster, onSelectRoute, onSelectZone, onSelectFacility };

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [82.8, 22.5],
      zoom: 4.4,
      preserveDrawingBuffer: true,
      attributionControl: false,
    });
    onSnapshotReady?.(() => {
      try {
        return map.getCanvas().toDataURL("image/png");
      } catch (error) {
        console.warn("Unable to capture the map for the response report", error);
        return null;
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left"
    );
    map.on("load", () => {
      ready.current = true;
      map.addSource("aoi", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "aoi-fill",
        type: "fill",
        source: "aoi",
        paint: { "fill-color": "#00cfff", "fill-opacity": 0.035 },
      });
      map.addLayer({
        id: "aoi-line",
        type: "line",
        source: "aoi",
        paint: { "line-color": "#52eaff", "line-width": 1.5, "line-opacity": 0.75, "line-dasharray": [2, 1] },
      });
      map.addSource("cluster-zones", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "cluster-zone-fill",
        type: "fill",
        source: "cluster-zones",
        paint: {
          "fill-color": [
            "case",
            ["get", "selected"], "#a8fbff",
            ["match", ["get", "severity"], "critical", "#ff526f", "high", "#ffb44c", "moderate", "#00cfff", "#00a9df"],
          ],
          "fill-opacity": ["case", ["get", "selected"], 0.28, 0.14],
        },
      });
      map.addLayer({
        id: "cluster-zone-line",
        type: "line",
        source: "cluster-zones",
        paint: {
          "line-color": [
            "case",
            ["get", "selected"], "#ffffff",
            ["match", ["get", "severity"], "critical", "#ff526f", "high", "#ffb44c", "moderate", "#52eaff", "#52eaff"],
          ],
          "line-width": ["case", ["get", "selected"], 2.5, 1.4],
          "line-dasharray": [1.5, 1],
        },
      });
      map.addSource("route", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": ["get", "routeColor"],
          "line-width": ["case", ["get", "selected"], 5, ["get", "clusterSelected"], 4, ["==", ["get", "rank"], 1], 3.5, 2.5],
          "line-opacity": ["case", ["get", "selected"], 1, ["get", "clusterSelected"], 0.92, 0.58],
        },
      });
      map.addSource("clusters", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "cluster-halo",
        type: "circle",
        source: "clusters",
        paint: {
          "circle-radius": 18,
          "circle-color": "#00cfff",
          "circle-opacity": 0.14,
          "circle-stroke-color": "#52eaff",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.65,
        },
      });
      map.addLayer({
        id: "cluster-core",
        type: "circle",
        source: "clusters",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 9, 7],
          "circle-color": [
            "case",
            ["get", "selected"], "#b5fbff",
            ["==", ["get", "routingStatus"], "unresolved"], "#ff526f",
            "#00cfff",
          ],
          "circle-stroke-color": "#b5fbff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "cluster-label",
        type: "symbol",
        source: "clusters",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 10,
          "text-offset": [0, 0.05],
          "text-allow-overlap": false,
          "symbol-sort-key": ["case", ["get", "selected"], 0, 1],
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#0369a1", "text-halo-width": 1.5 },
      });
      map.addSource("hospitals", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "hospitals-circle",
        type: "circle",
        source: "hospitals",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 10, ["get", "clusterSelected"], 8, 6],
          "circle-color": ["case", ["get", "selected"], "#ffffff", ["get", "clusterSelected"], "#52eaff", "#00cfff"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#042f2e",
        },
      });
      map.addLayer({
        id: "hospitals-label",
        type: "symbol",
        source: "hospitals",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-max-width": 14,
          "text-optional": true,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#e8fcff",
          "text-halo-color": "#071321",
          "text-halo-width": 1.5,
        },
      });
      map.addSource("facilities", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "facilities-circle",
        type: "circle",
        source: "facilities",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0b1220",
        },
      });
      map.addSource("centroid", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "centroid-halo",
        type: "circle",
        source: "centroid",
        paint: { "circle-radius": 18, "circle-color": "#ef4444", "circle-opacity": 0.18 },
      });
      map.addLayer({
        id: "centroid-core",
        type: "circle",
        source: "centroid",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ef4444",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      let pulseFrame = 0;
      let lastPulse = 0;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const animateAffectedArea = () => {
        if (reduceMotion) return;
        if (!map.isStyleLoaded()) {
          pulseFrame = requestAnimationFrame(animateAffectedArea);
          return;
        }
        const now = performance.now();
        if (now - lastPulse >= 80) {
          const pulse = (Math.sin(now / 1100) + 1) / 2;
          map.setPaintProperty("aoi-fill", "fill-opacity", 0.02 + pulse * 0.025);
          map.setPaintProperty("aoi-line", "line-opacity", 0.38 + pulse * 0.18);
          map.setPaintProperty(
            "cluster-zone-fill",
            "fill-opacity",
            ["case", ["get", "selected"], 0.24 + pulse * 0.06, 0.1 + pulse * 0.035]
          );
          map.setPaintProperty("cluster-halo", "circle-radius", 12 + pulse * 5);
          map.setPaintProperty("cluster-halo", "circle-opacity", 0.08 + pulse * 0.08);
          lastPulse = now;
        }
        pulseFrame = requestAnimationFrame(animateAffectedArea);
      };
      if (!reduceMotion) pulseFrame = requestAnimationFrame(animateAffectedArea);
      map.once("remove", () => cancelAnimationFrame(pulseFrame));

      map.on("click", "cluster-core", (e) => {
        const clusterId = String(e.features?.[0]?.properties?.id || "");
        if (clusterId) handlers.current.onSelectCluster?.(clusterId);
      });
      const clusterPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      let hoveredClusterId = "";
      map.on("mousemove", "cluster-core", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const id = String(feature.properties?.id || "");
        clusterPopup.setLngLat(e.lngLat);
        if (id !== hoveredClusterId) {
          hoveredClusterId = id;
          clusterPopup.setDOMContent(
            popupContent(
              `${id} · ${feature.properties?.severity || "severity unknown"}`,
              `${feature.properties?.routingStatus === "unresolved" ? "No validated route" : "Click to inspect ranked hospital routes"}`
            )
          );
        }
        if (!clusterPopup.isOpen()) clusterPopup.addTo(map);
      });
      map.on("mouseleave", "cluster-core", () => {
        hoveredClusterId = "";
        clusterPopup.remove();
      });
      const hospitalPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      let hoveredHospitalId = "";
      map.on("mousemove", "hospitals-circle", (e) => {
        const hospital = e.features?.[0]?.properties;
        if (!hospital) return;
        const id = String(hospital.id || "");
        hospitalPopup.setLngLat(e.lngLat);
        if (id !== hoveredHospitalId) {
          hoveredHospitalId = id;
          hospitalPopup.setDOMContent(
            popupContent(
              String(hospital.name || "Hospital directory entry"),
              `${hospital.operationalStatus || "Operational status unknown"} · ${hospital.distance ?? "—"} km geographic distance`
            )
          );
        }
        if (!hospitalPopup.isOpen()) hospitalPopup.addTo(map);
      });
      map.on("mouseleave", "hospitals-circle", () => {
        hoveredHospitalId = "";
        hospitalPopup.remove();
      });
      const affectedAreaPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      let hoveredZoneName = "";
      map.on("mousemove", "aoi-fill", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const name = String(feature.properties?.name || "Affected area");
        affectedAreaPopup.setLngLat(e.lngLat);
        if (name !== hoveredZoneName) {
          hoveredZoneName = name;
          affectedAreaPopup.setDOMContent(popupContent(
            name,
            "Major affected zone · select its boundary to focus the child clusters"
          ));
        }
        if (!affectedAreaPopup.isOpen()) affectedAreaPopup.addTo(map);
      });
      map.on("mouseleave", "aoi-fill", () => {
        hoveredZoneName = "";
        affectedAreaPopup.remove();
      });
      map.on("click", "cluster-zone-fill", (e) => {
        const clusterId = String(e.features?.[0]?.properties?.id || "");
        if (clusterId) handlers.current.onSelectCluster?.(clusterId);
      });
      map.on("click", "aoi-line", (e) => {
        const zoneId = String(e.features?.[0]?.properties?.id || "");
        if (zoneId) handlers.current.onSelectZone?.(zoneId);
      });
      map.on("click", "route-line", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const routeId = String(feature.properties?.routeId || "");
        if (routeId) handlers.current.onSelectRoute?.(routeId);
        new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setDOMContent(
            popupContent(
              String(feature.properties?.hospitalName || "Hospital route"),
              `${feature.properties?.clusterId} · ${feature.properties?.roadKm ?? "—"} km · ${feature.properties?.durationMin ?? "—"} min`
            )
          )
          .addTo(map);
      });
      map.on("click", "hospitals-circle", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = String(f.properties?.id || "");
        handlers.current.onSelectHospital?.(id);
        const routeId = String(f.properties?.routeId || "");
        if (routeId) handlers.current.onSelectRoute?.(routeId);
        new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setDOMContent(popupContent(String(f.properties?.name || "Hospital"), `${f.properties?.distance ?? "—"} km geographic`))
          .addTo(map);
      });
      map.on("click", "facilities-circle", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const properties = feature.properties || {};
        const id = String(properties.id || "");
        if (id) handlers.current.onSelectFacility?.(id);
        new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setDOMContent(
            popupContent(
              String(properties.name || "Response resource"),
              `${String(properties.type || "Facility").replaceAll("_", " ")} · ${properties.district || "District unavailable"}, ${properties.state || "State unavailable"} · ${properties.distanceKm ?? "—"} km · ${properties.operationalStatus || "Status unavailable"}`
            )
          )
          .addTo(map);
      });
      for (const layer of ["hospitals-circle", "facilities-circle", "cluster-core", "cluster-zone-fill", "aoi-fill", "aoi-line", "route-line"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });
    mapRef.current = map;
    return () => {
      onSnapshotReady?.(() => null);
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;

    const parentAreas = (disaster?.aois || [])
      .filter((aoi) => aoi.extentGeoJSON)
      .map((aoi) => ({
        type: "Feature" as const,
        properties: {
          id: `${disaster?.code}-AOI-${aoi.number}`,
          name: aoi.name,
        },
        geometry: aoi.extentGeoJSON as GeoJSON.Geometry,
      }));
    if (!parentAreas.length && disaster?.extentGeoJSON) {
      parentAreas.push({
        type: "Feature" as const,
        properties: { id: disaster.code, name: disaster.name },
        geometry: disaster.extentGeoJSON,
      });
    }
    (map.getSource("aoi") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: layers.aoi ? parentAreas : [],
    });

    const clusterHospitalRoutes = clusterRoutes.flatMap((cluster) =>
      cluster.hospitalRoutes.map((route) => ({ clusterId: cluster.id, route }))
    );
    const hospitalFeatures = new globalThis.Map<
      string,
      { hospital: Hospital; routeId?: string; clusterId?: string }
    >();
    hospitals.forEach((hospital) => hospitalFeatures.set(hospital.id, { hospital }));
    clusterHospitalRoutes.forEach(({ clusterId, route }) => {
      const existing = hospitalFeatures.get(route.hospital.id);
      const preferred =
        !existing?.routeId ||
        clusterId === selectedClusterId ||
        route.id === selectedRouteId;
      if (preferred) hospitalFeatures.set(route.hospital.id, {
        hospital: route.hospital,
        routeId: route.id,
        clusterId,
      });
    });
    (map.getSource("hospitals") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: layers.hospitals
        ? Array.from(hospitalFeatures.values()).map(({ hospital, routeId, clusterId }) => ({
            type: "Feature" as const,
            properties: {
              id: hospital.id,
              name: hospital.name,
              distance: hospital.distanceKm,
              operationalStatus: hospital.operationalStatus || "Unknown",
              selected: hospital.id === selectedHospitalId,
              clusterSelected: clusterId === selectedClusterId,
              routeId,
              clusterId,
            },
            geometry: { type: "Point", coordinates: [hospital.longitude, hospital.latitude] },
          }))
        : [],
    });

    const childAreas = layers.clusters
      ? clusterRoutes.flatMap((cluster) =>
          cluster.geometry
            ? [{
                type: "Feature" as const,
                properties: {
                  id: cluster.id,
                  label: cluster.id.split("-").at(-1)?.replace("C", "") || cluster.name,
                  selected: cluster.id === selectedClusterId,
                  severity: cluster.severity,
                },
                geometry: cluster.geometry,
              }]
            : []
        )
      : [];
    (map.getSource("cluster-zones") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: childAreas,
    });
    (map.getSource("clusters") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: layers.clusters
        ? clusterRoutes.map((cluster, index) => ({
            type: "Feature" as const,
            properties: {
              id: cluster.id,
              label: String(index + 1),
              selected: cluster.id === selectedClusterId,
              severity: cluster.severity,
              routingStatus: cluster.routingStatus,
            },
            geometry: {
              type: "Point" as const,
              coordinates: [cluster.longitude, cluster.latitude],
            },
          }))
        : [],
    });

    (map.getSource("facilities") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: facilities
        .filter((f) => layers[f.type] !== false && layers.infrastructure)
        .map((f) => ({
          type: "Feature" as const,
          properties: {
            id: f.id,
            name: f.name,
            type: f.type,
            state: f.state,
            district: f.district,
            distanceKm: f.distanceKm,
            source: f.source,
            operationalStatus: f.operationalStatus || "Unknown",
            color: FACILITY_COLOR[f.type] || "#94a3b8",
          },
          geometry: { type: "Point", coordinates: [f.longitude, f.latitude] },
        })),
    });

    const routeFeatures = layers.routes
      ? clusterRoutes.flatMap((cluster) =>
          cluster.hospitalRoutes.flatMap((route) =>
            route.routeGeometry
              ? [{
                  type: "Feature" as const,
                  properties: {
                    routeId: route.id,
                    clusterId: cluster.id,
                    hospitalId: route.hospital.id,
                    rank: route.rank,
                    hospitalName: route.hospital.name,
                    roadKm: route.roadKm,
                    durationMin: route.durationMin,
                    selected:
                      route.id === selectedRouteId ||
                      (!selectedRouteId && cluster.id === selectedClusterId && route.rank === 1),
                    clusterSelected: cluster.id === selectedClusterId,
                    routeColor: route.routeType === "recommended" ? "#00e5ff" : "#ffb44c",
                    routeType: route.routeType,
                  },
                  geometry: route.routeGeometry,
                }]
              : []
          )
        )
      : [];
    (map.getSource("route") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: routeFeatures,
    });

    (map.getSource("centroid") as maplibregl.GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: disaster?.centroid && layers.aoi
        ? [{
            type: "Feature",
            properties: { name: disaster.name },
            geometry: {
              type: "Point",
              coordinates: [disaster.centroid.longitude, disaster.centroid.latitude],
            },
          }]
        : [],
    });

    const visibility = (id: string, visible: boolean) =>
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    visibility("satellite-imagery", Boolean(layers.imagery) && !fallbackActive.current);
    visibility("fallback-imagery", Boolean(layers.imagery) && fallbackActive.current);
    visibility("hospitals-label", Boolean(layers.hospitals));
    if (!layers.imagery) fallbackActive.current = false;
    visibility("base-background", !layers.imagery);
  }, [
    disaster,
    hospitals,
    facilities,
    layers,
    selectedHospitalId,
    selectedClusterId,
    selectedRouteId,
    clusterRoutes,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleMapError = (event: maplibregl.ErrorEvent) => {
      if (
        !fallbackActive.current &&
        "sourceId" in event &&
        event.sourceId === "satellite" &&
        map.getLayer("fallback-imagery")
      ) {
        fallbackActive.current = true;
        map.setLayoutProperty("satellite-imagery", "visibility", "none");
        map.setLayoutProperty(
          "fallback-imagery",
          "visibility",
          layers.imagery ? "visible" : "none"
        );
      }
    };
    map.on("error", handleMapError);
    return () => {
      map.off("error", handleMapError);
    };
  }, [layers.imagery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !disaster?.centroid) return;
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([disaster.centroid.longitude, disaster.centroid.latitude]);
    const extendCoordinates = (coordinates: unknown) => {
      if (!Array.isArray(coordinates)) return;
      if (
        coordinates.length >= 2 &&
        typeof coordinates[0] === "number" &&
        typeof coordinates[1] === "number"
      ) {
        bounds.extend([coordinates[0], coordinates[1]]);
        return;
      }
      coordinates.forEach(extendCoordinates);
    };
    const extentGeometry = disaster.extentGeoJSON;
    if (extentGeometry && "coordinates" in extentGeometry) {
      extendCoordinates(extentGeometry.coordinates);
    }
    clusterRoutes.forEach((cluster) => {
      extendCoordinates(cluster.geometry && "coordinates" in cluster.geometry ? cluster.geometry.coordinates : []);
      cluster.hospitalRoutes.forEach((route) => {
        extendCoordinates(route.routeGeometry && "coordinates" in route.routeGeometry ? route.routeGeometry.coordinates : []);
      });
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 800 });
  }, [disaster?.id, clusterRoutes]);

  return <div ref={ref} className="h-full w-full" />;
}

function popupContent(title: string, detail: string) {
  const root = document.createElement("div");
  root.className = "text-xs";
  const heading = document.createElement("div");
  heading.className = "font-semibold";
  heading.textContent = title;
  const subheading = document.createElement("div");
  subheading.className = "text-slate-400";
  subheading.textContent = detail;
  root.append(heading, subheading);
  return root;
}

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
