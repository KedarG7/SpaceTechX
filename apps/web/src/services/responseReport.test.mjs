import test from "node:test";
import assert from "node:assert/strict";
import { buildImageryReportTable } from "./responseReport.ts";

test("renders source acquisition details safely in the response report", () => {
  const table = buildImageryReportTable([{
    aoiName: "Kastelli <North>",
    productType: "DEL",
    sensorName: "Sentinel-1",
    sensorType: "sar",
    resolutionClass: "HR+",
    acquisitionTime: "2026-10-04T16:22:00",
    fileName: "scene & map.tif",
    uuid: "source-record-1",
    new: true,
  }]);

  assert.match(table, /Kastelli &lt;North&gt;/);
  assert.match(table, /Sentinel-1/);
  assert.match(table, /2026-10-04T16:22:00/);
  assert.match(table, /New acquisition/);
  assert.match(table, /source-record-1/);
  assert.match(table, /scene &amp; map\.tif/);
  assert.doesNotMatch(table, /<img|<script|javascript:/i);
});

test("reports absent and unspecified source-image data without fabricating it", () => {
  const missingStatus = buildImageryReportTable([{
    aoiName: "Kastelli",
    productType: "DEL",
    sensorName: "Sentinel-1",
    sensorType: "sar",
  }]);

  assert.match(buildImageryReportTable([]), /No source image acquisitions were listed/);
  assert.match(missingStatus, /Status not provided/);
  assert.match(missingStatus, /Source record ID not provided/);
  assert.doesNotMatch(missingStatus, /<img|https?:\/\//i);
});
