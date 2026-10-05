import test from "node:test";
import assert from "node:assert/strict";
import { hydrateDetail } from "../src/services/copernicusService.js";

test("preserves Copernicus acquisition identifiers and status without inventing image URLs", () => {
  const detail = hydrateDetail({
    code: "EMSR933",
    name: "Flood in Crete, Greece",
    category: "Flood",
    countries: ["Greece"],
    closed: false,
    aois: [{
      name: "Kastelli",
      number: 1,
      products: [{
        type: "DEL",
        images: [{
          uuid: "98631c62-2d55-4a9b-8b65-3f077c2a79aa",
          new: true,
          sensorType: "sar",
          sensorName: "Sentinel-1",
          resolutionClass: "HR+",
          acquisitionTime: "2026-10-04T16:22:00",
          fileName: "scene.tif",
        }],
      }],
    }],
  });

  assert.deepEqual(detail.imagery[0], {
    aoiName: "Kastelli",
    productType: "DEL",
    uuid: "98631c62-2d55-4a9b-8b65-3f077c2a79aa",
    new: true,
    sensorType: "sar",
    sensorName: "Sentinel-1",
    resolutionClass: "HR+",
    acquisitionTime: "2026-10-04T16:22:00",
    fileName: "scene.tif",
  });
  assert.equal("url" in detail.imagery[0], false);
});
