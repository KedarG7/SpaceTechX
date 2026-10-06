
# ResQMap

ResQMap is an emergency-response decision-support prototype. It combines Copernicus EMS incident/AOI data, source-clipped operational map clusters, a compiled hospital directory, and estimated road-network routes. It is **not validated for live dispatch or operational readiness**.

## Data and confidence boundaries

- **Incidents and affected-area boundaries:** Copernicus EMS Rapid Mapping public activation API. The API provides incident/AOI footprints and product statistics; the current public detail response does not supply point-level damage or population observations. Therefore the normal clustering mode samples small representative cells from valid AOI polygons. It does not imply observed damage hotspots. A DBSCAN implementation is available for verified point features when a source supplies them.
- **Image acquisitions and products:** Copernicus detail provides acquisition metadata (sensor, time, resolution, source record ID, and filename when supplied) plus an official analysis-product archive. It does not provide embeddable source-scene pixel URLs in the activation detail response. The PDF includes the visible ResQMap map capture and acquisition metadata, and links the official product archive; it labels the Esri basemap separately from Copernicus source acquisitions.
- **Hospital candidates:** `apps/api/src/data/hospitals.js`, a compiled Government of India directory seed dated 2025-06-01. Nearby candidates are compared by road-network distance, including smaller facilities when they exist in the directory. The source does not provide live occupancy, operational status, or reliable route closures. Directory locations and emergency capability require current field verification before dispatch.
- **Routes:** OSRM on OpenStreetMap road-network data by default, or OpenRouteService if configured. Route distance and time are road-network estimates, not live traffic ETAs. A route is returned only when road geometry is present, coordinate-valid, and its endpoint snaps are within the configured threshold. No straight-line route is substituted.
- **Satellite basemap:** Esri World Imagery by default. OpenStreetMap raster tiles are used as a fallback when the satellite tile source reports an error. Attribution is shown on the map.
- **Population at cluster scale:** if only AOI-level population statistics exist, cluster values are explicitly labeled low-confidence area-proportional estimates, not observed counts.

## Running and validation

Requires Node.js with native TypeScript type stripping (Node 22.6+; Node 26 tested) for the cluster-engine tests.

```sh
npm install
npm run dev
npm test
npm run build -w web
```

The API listens on port 8787 by default and the Vite client on port 5173. The web client calls `/api` through the Vite development proxy; production deployments must route `/api` to the API service.
If port 8787 is already in use, start both dev services on another API port, for example `API_PORT=8788 npm run dev`. The Vite proxy follows `API_PORT` automatically. `API_PROXY_TARGET` can still be set when proxying to a separately hosted API.

### Prototype authentication

Create `apps/api/.env` from `apps/api/.env.example` and set the one prototype operator account and independent random `JWT_SECRET` and `SESSION_SECRET` values there. Keep all of these values on the API; do not use `VITE_*` variables for credentials or secrets. The cookie is HTTP-only and sessions are revoked server-side. The prototype stores revocation state in memory, so restarting the API signs out active sessions; a deployment with multiple API instances needs a shared session store.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROUTING_PROVIDER` | `osrm` | `osrm` or `ors`; configure on the API only. |
| `OSRM_URL` | `https://router.project-osrm.org` | OSRM-compatible routing/matrix endpoint. Public demo service has no production SLA. |
| `ORS_URL` | `https://api.openrouteservice.org` | OpenRouteService endpoint. |
| `ORS_API_KEY` | unset | Required on the API when `ROUTING_PROVIDER=ors`; never expose in Vite variables. |
| `ROUTING_REQUEST_INTERVAL_MS` | `700` | Minimum interval between requests to the selected routing provider. |
| `MAX_HOSPITAL_ROUTES_PER_CLUSTER` | `4` | Returned road-validated hospital routes per cluster; effective range 3–5. |
| `MAX_ROUTE_SNAP_KM` | `2` | Maximum allowed router snap distance at either route endpoint. |
| `ROUTE_CACHE_TTL_MS` | `300000` | Successful route/matrix cache duration. Failed route responses are not cached. |
| `ROUTE_WEIGHT_TRAVEL_TIME` | `0.4` | Relative route-scoring weight. Severity increases travel-time weight for critical/high incidents. |
| `ROUTE_WEIGHT_ROAD_DISTANCE` | `0.2` | Relative route-scoring weight. |
| `ROUTE_WEIGHT_SEVERITY` | `0.1` | Relative route-scoring weight; prioritizes high-severity clusters in global recommendation ordering. |
| `ROUTE_WEIGHT_EMERGENCY_CAPABILITY` | `0.1` | Relative route-scoring weight; based only on the published directory listing. |
| `ROUTE_WEIGHT_AVAILABILITY` | `0.1` | Relative route-scoring weight; availability is neutral/unknown unless source-backed status exists. |
| `ROUTE_WEIGHT_ROAD_ACCESSIBILITY` | `0.1` | Relative route-scoring weight; unreachable routes are rejected. No closure feed is currently integrated. |
| `MAX_CLUSTER_AREA_KM2` | `82.47` | API-validated maximum submitted cluster area (about a 5 km radius). |
| `DATABASE_URL` | unset | Optional PostGIS store; current startup seeds it from the same compiled hospital/facility dataset. |
| `NDRF_ADMIN_EMAIL` | unset | The single authorized prototype login email; API only. |
| `NDRF_ADMIN_PASSWORD` | unset | The single authorized prototype password; API only. |
| `JWT_SECRET` | unset | Random signing secret, at least 32 characters; API only. |
| `JWT_EXPIRES_IN` | `8h` | Session lifetime; maximum 24 hours. |
| `SESSION_SECRET` | unset | Separate random server-side session key, at least 32 characters; API only. |
| `CLIENT_URL` | `http://localhost:5173` in development | Exact frontend origin allowed for browser authentication requests. |
| `NODE_ENV` | `development` | Production mode enables secure cookies and HSTS on HTTPS requests. |
| `TRUST_PROXY_HOPS` | `0` | Explicit Express proxy trust count; set only for the deployment's known reverse-proxy chain. |
| `API_PORT` | `8787` | API bind port and Vite proxy port in development; `PORT` remains a deployment fallback. |
| `VITE_CLUSTER_RADIUS_KM` | `5` | Cluster radius and DBSCAN neighborhood distance for verified impact points. |
| `VITE_CLUSTER_MIN_AFFECTED_POINTS` | `3` | DBSCAN minimum points; no point-level observations currently arrive from Copernicus detail. |
| `VITE_MAX_CLUSTERS` | `12` | Maximum clusters submitted for routing. |
| `VITE_SATELLITE_TILE_URL` | Esri World Imagery | Optional MapLibre raster URL template. |
| `VITE_SATELLITE_ATTRIBUTION` | Esri attribution | Attribution for the configured satellite tile source. |

## Geospatial and routing behavior

- Cluster GeoJSON is validated again by the API against the activation's source AOI. The API rejects invalid, oversized, disconnected, overlapping, or out-of-AOI cluster geometry and recomputes route origins from geometry instead of trusting browser-supplied coordinates.
- Nearby directory entries are used only to form a bounded candidate set. The recommendation uses the nearest returned validated road route per cluster, including local hospitals present in the directory; capacity and live availability remain unverified.
- Each cluster is routed independently; the same hospital can be recommended for more than one cluster when it is nearest. Availability is unknown, so recommendations are not exclusive-capacity assignments.
- Debug diagnostics can be enabled from the route panel to inspect road-matrix candidates, score components, and rejected route candidates.
- The response report opens the browser print dialog from an in-page print frame; choose “Save as PDF” in the browser’s print destination to create the PDF.
- Before operational use, replace the compiled directory with a verified, maintained facility feed; add authorized live facility capacity and road closure/traffic inputs; and validate coverage, route snaps, dispatch policy, and failure procedures with local emergency operators.
