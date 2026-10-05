import test from "node:test";
import assert from "node:assert/strict";
import {
  centroidOfPolygon,
  haversineKm,
  parsePoint,
  parsePolygon,
  polygonAreaKm2,
} from "../src/utils/geo.js";

test("preserves GeoJSON longitude-latitude order and validates bounds", () => {
  assert.deepEqual(parsePoint("POINT(82.8 22.5)"), { longitude: 82.8, latitude: 22.5 });
  assert.deepEqual(parsePoint({ longitude: "82.8", latitude: "22.5" }), {
    longitude: 82.8,
    latitude: 22.5,
  });
  assert.equal(parsePoint("POINT(190 22.5)"), null);
  assert.equal(parsePoint({ longitude: 82.8, latitude: 91 }), null);
  assert.ok(haversineKm(22.5, 82.8, 22.51, 82.81) > 1);
});

test("parses and measures Polygon and MultiPolygon WKT with valid rings", () => {
  const polygon = parsePolygon("POLYGON ((82.7 22.4, 82.9 22.4, 82.9 22.6, 82.7 22.6, 82.7 22.4))");
  assert.equal(polygon?.type, "Polygon");
  assert.ok((polygonAreaKm2(polygon) || 0) > 0);
  const multipolygon = parsePolygon(
    "MULTIPOLYGON (((82.7 22.4, 82.8 22.4, 82.8 22.5, 82.7 22.5, 82.7 22.4)), ((82.85 22.45, 82.9 22.45, 82.9 22.5, 82.85 22.5, 82.85 22.45)))"
  );
  assert.equal(multipolygon?.type, "MultiPolygon");
  assert.ok((polygonAreaKm2(multipolygon) || 0) > 0);
  assert.ok(centroidOfPolygon(multipolygon));
  assert.equal(parsePolygon("POLYGON ((broken))"), null);
});
