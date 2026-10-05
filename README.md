# National Disaster Response Intelligence

A geospatial disaster-response intelligence platform that integrates **Copernicus Emergency Management Service** satellite-derived disaster information with **Indian government healthcare** and **infrastructure** datasets to give emergency-response teams a unified operational view of affected areas, nearby medical facilities, critical infrastructure and accessible routes.

This is a decision-support system. It does **not** issue operational orders, and it does **not** invent live hospital occupancy.

## Architecture

```
Copernicus EMS (disaster / AOI / damage)
        +
GoI hospital directory (compiled seed)
        +
OpenStreetMap facilities + OSRM routing
        ▼
Node.js fusion API  (+ optional PostGIS)
        ▼
React + MapLibre operations dashboard
```

## Quick start

```bash
npm install
npm run dev
```

- API: http://localhost:8787/api/health  
- Dashboard: http://localhost:5173  

The API works **without** PostgreSQL. Nearest-facility search then uses a haversine engine. For production-shaped geography:

```bash
docker compose up -d
export DATABASE_URL=postgres://ndrf:ndrf@localhost:5432/ndrf
npm run dev
```

## Operating modes

| Mode | Behaviour |
| --- | --- |
| **India focus** (default) | Live Copernicus activations that list India, plus an India historical/demo catalogue |
| **Demo / historical** | India-only rehearsal incidents (Assam, Mumbai, Kerala, Odisha, Uttarakhand, Himachal, Chennai, Bihar) |
| **Live Copernicus only** | Public Rapid Mapping activations as published |
| **South Asia watch** | India + neighbouring CEMS events (e.g. Nepal flood) |

Copernicus Rapid Mapping does **not** always have an open Indian activation. Demo mode is intentional so a briefing never depends on that.

## What the first milestone proves

1. React never calls Copernicus directly.  
2. `GET /api/disasters` returns fused activation cards.  
3. India is the default geographic filter.  
4. Selecting an incident flies the map to the centroid + AOI.  
5. Nearest hospitals are queried from the compiled GoI directory.  
6. The affected extent is divided into representative map clusters; each cluster gets its own nearest-hospital lookup and road route.  
7. Cluster-to-hospital routes use road-network distance and ETA from OSRM or OpenRouteService. If road routing is unavailable, the dashboard labels the route unavailable and does not draw a straight-line substitute.

The dashboard opens on configurable Esri World Imagery satellite tiles. Set `VITE_SATELLITE_TILE_URL` and `VITE_SATELLITE_ATTRIBUTION` in the web build environment to use another XYZ imagery provider. Its blue AOI and cluster pulse is visual emphasis only; it does not represent live water depth or hazard intensity. Disaster confidence is a transparent heuristic (not a calibrated probability), weighted across data reliability (25%), severity classification (15%), source agreement (20%), location accuracy (20%), and information recency (20%). Where independent source corroboration is not reported, the neutral midpoint is used and disclosed.

Affected child zones are generated from the selected disaster AOI using Turf.js: candidate grid cells are clipped to the parent polygon and representative points are checked against the child geometries. The bounded cluster count is six, so the public routing services are not flooded with per-polygon requests. A single road matrix ranks hospitals for all cluster origins; individual route geometries are cached for five minutes. Hospital scoring uses road ETA/distance and recorded emergency capability. Static directory beds are a tie-breaker only, not live availability. The hospital seed is small enough that Supercluster is not used.

Routing provider configuration (API process environment):

| Variable | Default / purpose |
| --- | --- |
| `ROUTING_PROVIDER` | `osrm`; set to `ors` to use OpenRouteService |
| `OSRM_URL` | `https://router.project-osrm.org` |
| `ORS_URL` | `https://api.openrouteservice.org` |
| `ORS_API_KEY` | Required when `ROUTING_PROVIDER=ors` |
| `ROUTE_CACHE_TTL_MS` | `300000` (five-minute successful route/matrix cache) |
| `ROUTING_REQUEST_INTERVAL_MS` | `700` minimum delay between requests |
| `MAX_HOSPITAL_ROUTES_PER_CLUSTER` | `2` (bounded to 1–3 to limit external routing requests) |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/disasters` | List activations (`?mode=india\|demo\|live\|regional`) |
| GET | `/api/disasters/:id` | AOI, stats, data-confidence |
| GET | `/api/disasters/:id/area` | GeoJSON extents |
| GET | `/api/disasters/:id/hospitals` | Nearest medical facilities + routes |
| POST | `/api/disasters/:id/cluster-routes` | Road-ranked hospital alternatives and road routes for each affected-area cluster (`clusters`: 1–8 cluster objects with IDs, parent zone IDs, and coordinates) |
| GET | `/api/disasters/:id/facilities` | Fire, police, ambulance, NDRF, relief, helipads |
| GET | `/api/disasters/:id/routes` | OSRM geometries |
| POST | `/api/disasters/:id/sitrep` | Situation report text |
| POST | `/api/disasters/:id/assistant` | Grounded operator Q&A |
| GET | `/api/statistics` | EOC counts |
| GET | `/api/freshness` | Source timestamps |
| GET | `/api/audit` | Operator action trail |

## Data honesty

| Layer | Source | Confidence |
| --- | --- | --- |
| Disaster activations | Copernicus EMS Rapid Mapping public API | Live when fetched |
| Demo AOIs | Prototype polygons around documented Indian event localities | Not official CEMS footprints |
| Hospitals | National Hospital Directory fields compiled for the prototype (source catalogue updated June 2025) | Coordinates/directory beds only. **Live availability = Unknown** |
| Facilities | OSM + public NDRF battalion locations | Compiled, status unknown |
| Routes | OSRM or OpenRouteService on OpenStreetMap | Road-network route or explicitly unavailable; no straight-line road-route substitute |

## Stack

Frontend: React, Vite, TypeScript, MapLibre GL JS, Turf.js, Tailwind CSS  
Backend: Node.js, Express  
Optional GIS: PostgreSQL + PostGIS  
Routing: OSRM  

## Pitch line

Do not describe this as “a dashboard that gets disaster data from a European website.”

Describe it as a **geospatial disaster-response intelligence platform** that fuses Copernicus EMS with Indian healthcare and infrastructure layers for NDRF / SDMA emergency operations.
