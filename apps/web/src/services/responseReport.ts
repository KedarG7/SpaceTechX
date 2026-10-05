import type { DisasterDetail } from "./api";

type ImageAcquisition = NonNullable<DisasterDetail["imagery"]>[number];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function acquisitionStatus(image: ImageAcquisition) {
  if (image.new === true) return "New acquisition";
  if (image.new === false) return "Previously acquired";
  return "Status not provided";
}

export function buildImageryReportTable(imagery?: ImageAcquisition[] | null) {
  if (!imagery?.length) {
    return '<p class="muted">No source image acquisitions were listed for this activation.</p>';
  }

  const rows = imagery.map((image) =>
    `<tr><td><b>${escapeHtml(image.aoiName || "AOI")}</b><br>${escapeHtml(image.productType || "Product")}</td><td>${escapeHtml(image.sensorName || image.sensorType || "Satellite sensor")}<br>${escapeHtml(image.resolutionClass || "Resolution not listed")}</td><td>${escapeHtml(image.acquisitionTime || "Time not provided")}<br><span class="muted">${acquisitionStatus(image)}</span></td><td>${escapeHtml(image.uuid || "Source record ID not provided")}<br><span class="muted">${escapeHtml(image.fileName || "Source filename not provided")}</span></td></tr>`
  ).join("");

  return `<table class="imagery-table"><thead><tr><th>AOI / product</th><th>Sensor / resolution</th><th>Acquisition</th><th>Source record / filename</th></tr></thead><tbody>${rows}</tbody></table>`;
}
