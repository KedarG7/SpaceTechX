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
  },
  layers: [
    { id: "base-background", type: "background", paint: { "background-color": "#101826" } },
    { id: "satellite-imagery", type: "raster", source: "satellite" },
  ],
};

const FACILITY_COLOR: Record<string, string> = {
  fire_station: "#f97316",
  police: "#60a5fa",
  ambulance: "#f472b6",
  ndrf: "#FF9933",
  relief_centre: "#a3e635",
  helipad: "#22d3ee",
  water: "#38bdf8",
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
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const ready = useRef(false);
  const handlers = useRef({ onSelectHospital, onSelectCluster, onSelectRoute, onSelectZone });
  handlers.current = { onSelectHospital, onSelectCluster, onSelectRoute, onSelectZone };

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [82.8, 22.5],
      zoom: 4.4,
      attributionControl: false,
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
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "aoi-line",
        type: "line",
        source: "aoi",
        paint: { "line-color": "#7dd3fc", "line-width": 2, "line-opacity": 0.8, "line-dasharray": [2, 1] },
      });
      map.addSource("cluster-zones", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "cluster-zone-fill",
        type: "fill",
        source: "cluster-zones",
        paint: {
          "fill-color": ["case", ["get", "selected"], "#38bdf8", "#0ea5e9"],
          "fill-opacity": ["case", ["get", "selected"], 0.24, 0.1],
        },
      });
      map.addLayer({
        id: "cluster-zone-line",
        type: "line",
        source: "cluster-zones",
        paint: {
          "line-color": ["case", ["get", "selected"], "#e0f2fe", "#7dd3fc"],
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
          "circle-color": "#38bdf8",
          "circle-opacity": 0.14,
          "circle-stroke-color": "#7dd3fc",
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
          "circle-color": ["case", ["get", "selected"], "#e0f2fe", "#0ea5e9"],
          "circle-stroke-color": "#e0f2fe",
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
          "text-allow-overlap": true,
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
          "circle-color": ["case", ["get", "selected"], "#ffffff", ["get", "clusterSelected"], "#5eead4", "#2dd4bf"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#042f2e",
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
          map.setPaintProperty("aoi-fill", "fill-opacity", 0.09 + pulse * 0.08);
          map.setPaintProperty("aoi-line", "line-opacity", 0.55 + pulse * 0.3);
          map.setPaintProperty(
            "cluster-zone-fill",
            "fill-opacity",
            ["case", ["get", "selected"], 0.2 + pulse * 0.08, 0.06 + pulse * 0.05]
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
      for (const layer of ["hospitals-circle", "cluster-core", "cluster-zone-fill", "aoi-fill", "aoi-line", "route-line"]) {
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
          properties: { name: f.name, type: f.type, color: FACILITY_COLOR[f.type] || "#94a3b8" },
          geometry: { type: "Point", coordinates: [f.longitude, f.latitude] },
        })),
    });

    const clusterColors = ["#38bdf8", "#a78bfa", "#2dd4bf", "#fb7185", "#60a5fa", "#f97316"];
    const routeFeatures = layers.routes
      ? clusterRoutes.flatMap((cluster, clusterIndex) =>
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
                    routeColor: route.rank === 1 ? clusterColors[clusterIndex % clusterColors.length] : "#fbbf24",
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
    visibility("satellite-imagery", Boolean(layers.imagery));
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
