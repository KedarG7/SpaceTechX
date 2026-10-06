import test from "node:test";
import assert from "node:assert/strict";
import { validateAffectedClusters } from "../src/services/clusterValidation.js";
import { squarePolygon, testDisaster } from "./helpers.js";

const parentZoneId = "TEST-ACTIVATION-AOI-1";

function inputCluster(id, geometry = squarePolygon(82.8, 22.5)) {
  return {
    id,
    parentZoneId,
    latitude: -80,
    longitude: 179,
    geometry,
  };
}

test("server derives routing origin, area, and low-confidence population from source AOI", () => {
  const [cluster] = validateAffectedClusters(
    [inputCluster("cluster-1")],
    testDisaster()
  );
  assert.ok(Math.abs(cluster.latitude - 22.5) < 0.0001);
  assert.ok(Math.abs(cluster.longitude - 82.8) < 0.0001);
  assert.ok(cluster.areaKm2 > 0 && cluster.areaKm2 < 82.47);
  assert.ok(cluster.populationEstimate > 0);
  assert.match(cluster.populationEstimateMethod, /Low-confidence area-proportional/);
  assert.equal(cluster.originMethod, "verified source-AOI geometry representative point");
});

test("rejects clusters outside source AOI", () => {
  assert.throws(
    () => validateAffectedClusters(
      [inputCluster("outside", squarePolygon(83.1, 22.5))],
      testDisaster()
    ),
    /extends outside its source AOI/
  );
});

test("rejects oversized, invalid, missing, and duplicate cluster input", () => {
  assert.throws(
    () => validateAffectedClusters([inputCluster("large", squarePolygon(82.8, 22.5, 0.1))], testDisaster()),
    /area must be between/
  );
  const invalid = {
    type: "Polygon",
    coordinates: [[
      [82.8, 22.5],
      [82.81, 22.51],
      [82.8, 22.51],
      [82.81, 22.5],
      [82.8, 22.5],
    ]],
  };
  assert.throws(() => validateAffectedClusters([inputCluster("invalid", invalid)], testDisaster()), /invalid GeoJSON/);
  assert.throws(() => validateAffectedClusters([inputCluster("missing", null)], testDisaster()), /missing, unsupported/);
  assert.throws(() => validateAffectedClusters([inputCluster("same"), inputCluster("same")], testDisaster()), /Duplicate cluster ID/);
});

test("rejects intersecting cluster footprints even when submitted under different source zones", () => {
  const secondZone = {
    type: "Polygon",
    coordinates: [[
      [82.7, 22.4],
      [82.9, 22.4],
      [82.9, 22.6],
      [82.7, 22.6],
      [82.7, 22.4],
    ]],
  };
  const disaster = testDisaster();
  disaster.aois.push({ number: 2, name: "Overlapping AOI", extentGeoJSON: secondZone });
  const overlapping = {
    ...inputCluster("cluster-2"),
    parentZoneId: "TEST-ACTIVATION-AOI-2",
  };
  assert.throws(
    () => validateAffectedClusters([inputCluster("cluster-1"), overlapping], disaster),
    /overlaps another cluster/
  );
});
