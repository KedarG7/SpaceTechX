import test from "node:test";
import assert from "node:assert/strict";
import { validateRouteGeometry } from "../src/services/routingService.js";

const from = { latitude: 22.5, longitude: 82.8 };
const to = { latitude: 22.51, longitude: 82.81 };

test("accepts connected LineString routes with endpoint snaps within limit", () => {
  const result = validateRouteGeometry(from, to, {
    geometry: {
      type: "LineString",
      coordinates: [
        [82.8001, 22.5001],
        [82.805, 22.505],
        [82.8099, 22.5099],
      ],
    },
    distanceKm: 2.2,
    durationMin: 8,
  });
  assert.equal(result.valid, true);
  assert.ok(result.startSnapKm < 0.1);
  assert.ok(result.endSnapKm < 0.1);
});

test("rejects unsupported, malformed, unsnapped, or implausibly short routes", () => {
  assert.equal(validateRouteGeometry(from, to, { geometry: null }).valid, false);
  assert.equal(validateRouteGeometry(from, to, {
    geometry: { type: "LineString", coordinates: [[181, 22.5], [82.81, 22.51]] },
    distanceKm: 4,
    durationMin: 8,
  }).valid, false);
  assert.match(validateRouteGeometry(from, to, {
    geometry: { type: "LineString", coordinates: [[82.83, 22.5], [82.81, 22.51]] },
    distanceKm: 5,
    durationMin: 8,
  }).reason, /snap exceeds/);
  assert.match(validateRouteGeometry(from, to, {
    geometry: { type: "LineString", coordinates: [[82.8, 22.5], [82.81, 22.51]] },
    distanceKm: 0.1,
    durationMin: 8,
  }).reason, /implausibly shorter/);
});
