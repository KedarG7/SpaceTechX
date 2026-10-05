export function generateSitrep(disaster, hospitals = [], facilities = []) {
  const impact = disaster.impact || {};
  const nearest = hospitals.slice(0, 5);
  const fires = facilities.filter((f) => f.type === "fire_station");
  const amb = facilities.filter((f) => f.type === "ambulance");
  const ndrf = facilities.filter((f) => f.type === "ndrf");

  const lines = [
    "NATIONAL DISASTER RESPONSE FORCE",
    "SITUATION REPORT (AUTO-GENERATED DECISION SUPPORT)",
    "================================================",
    "",
    `Incident:          ${disaster.name}`,
    `Activation:        ${disaster.code}`,
    `Category:          ${disaster.category}${disaster.subCategory ? ` / ${disaster.subCategory}` : ""}`,
    `Severity (derived): ${String(disaster.severity || "").toUpperCase()}`,
    `Mode:              ${disaster.mode === "live" ? "LIVE Copernicus EMS" : "DEMO / HISTORICAL"}`,
    `Location:          ${[disaster.district, disaster.state, disaster.countries?.join(", ")].filter(Boolean).join(", ")}`,
    `Event time (UTC):  ${disaster.eventTime || "Unknown"}`,
    `Activation time:   ${disaster.activationTime || "Unknown"}`,
    `Last update:       ${disaster.lastUpdate || "Unknown"} (${disaster.relativeUpdate || ""})`,
    `Status:            ${disaster.closed ? "Closed activation" : "Open activation"}`,
    "",
    "IMPACT (as reported by source — not independently verified by this platform)",
    "------------------------------------------------",
    `Affected area:           ${disaster.affectedAreaKm2 ?? "Unknown"} km²`,
    `Estimated population:    ${impact.populationEstimated ?? "Unknown"}`,
    `Population in affected:  ${impact.populationAffected ?? "Unknown"}`,
    `Buildings affected:      ${impact.buildingsAffected ?? "Unknown"}`,
    `Roads affected:          ${impact.roadsAffectedKm ?? "Unknown"} km`,
    "",
    "NARRATIVE",
    "------------------------------------------------",
    disaster.reason || "No narrative supplied by the source activation.",
    "",
    "NEAREST MEDICAL FACILITIES",
    "------------------------------------------------",
  ];

  if (!nearest.length) {
    lines.push("No hospitals in the compiled directory within the search radius.");
  } else {
    nearest.forEach((h, i) => {
      const road = h.roadKm != null
        ? `${h.roadKm} km road / ${h.durationMin} min`
        : h.confidence === "unavailable"
          ? "road route unavailable (no straight-line substitute)"
          : "road distance pending";
      lines.push(
        `${i + 1}. ${h.name} (${h.category}, ${h.district}) — ${h.distanceKm} km geographic, ${road}. Emergency tag: ${h.emergency ? "yes" : "unspecified"}. Beds (directory): ${h.beds ?? "Unknown"}. Live availability: Unknown.`
      );
    });
  }

  lines.push(
    "",
    "NEARBY RESPONSE INFRASTRUCTURE (compiled layers)",
    "------------------------------------------------",
    `Fire stations:     ${fires.length}`,
    `Ambulance nodes:   ${amb.length}`,
    `NDRF / staging:    ${ndrf.map((n) => n.name).join("; ") || "none in radius"}`,
    "",
    "DATA SOURCES",
    "------------------------------------------------",
    disaster.mode === "live"
      ? "Disaster / AOI / damage statistics: Copernicus EMS Rapid Mapping public API"
      : `Disaster / AOI: ${disaster.source}`,
    "Hospitals: Government of India National Hospital Directory (compiled seed, updated June 2025 in source catalogue)",
    "Facilities: OpenStreetMap + NDRF public battalion locations (compiled)",
    "Routes: OSRM/OpenRouteService road-network geometry; unavailable routes are not replaced with straight-line paths",
    "",
    "CAVEATS",
    "------------------------------------------------",
    "This sitrep is a decision-support product. It does not issue operational orders.",
    "Hospital bed figures are directory values, not live occupancy.",
    "Do not treat closed/historical activations as current ground truth.",
    `Generated at: ${new Date().toISOString()}`,
  );

  return lines.join("\n");
}

export function answerOperator(message, context) {
  const q = (message || "").toLowerCase();
  const { disaster, hospitals, facilities, routes } = context;
  const impact = disaster.impact || {};

  const cite = (text, sources) => ({
    text,
    sources,
    invented: false,
  });

  if (/hospital|medical|health/.test(q)) {
    const kmMatch = q.match(/(\d+)\s*km/);
    const radius = kmMatch ? Number(kmMatch[1]) : 50;
    const list = hospitals.filter((h) => h.distanceKm <= radius).slice(0, 8);
    if (!list.length) {
      return cite(
        `No compiled directory hospitals were found within ${radius} km of ${disaster.name}. This does not prove that no facilities exist — only that none are in the seeded Government of India hospital layer used by this prototype.`,
        ["Government of India National Hospital Directory (compiled seed)"]
      );
    }
    const lines = list.map(
      (h) =>
        `• ${h.name} (${h.district}, ${h.category}) — ${h.distanceKm} km geographic` +
        (h.roadKm != null ? `, ${h.roadKm} km by road (~${h.durationMin} min)` : "") +
        `. Directory beds: ${h.beds ?? "Unknown"}. Live availability: Unknown.`
    );
    return cite(
      `Nearest medical facilities to ${disaster.code} (${disaster.name}) within ${radius} km:\n${lines.join("\n")}\n\nThese distances are computed from the activation centroid. Live bed occupancy is not available in this system.`,
      [
        disaster.mode === "live" ? "Copernicus EMS Rapid Mapping" : disaster.source,
        "Government of India National Hospital Directory (compiled seed)",
        routes?.length ? "OSRM / OpenStreetMap" : "Haversine geographic distance",
      ]
    );
  }

  if (/road|route|access|travel/.test(q)) {
    return cite(
      `Reported road impact for ${disaster.code}: ${impact.roadsAffectedKm ?? "Unknown"} km affected` +
        (impact.roadsTotalKm ? ` of ${impact.roadsTotalKm} km assessed` : "") +
        `. ${
          routes?.length
            ? `Sample routed travel: ${routes
                .slice(0, 3)
                .map((r) => `${r.name} ${r.roadKm} km / ${r.durationMin} min (${r.confidence})`)
                .join("; ")}.`
            : "Request a route from the dashboard to attach OSRM road distance and travel time."
        } Road impact figures come from the disaster product statistics, not from a live traffic feed.`,
      [
        disaster.mode === "live" ? "Copernicus EMS Rapid Mapping product statistics" : "Demo product statistics patterned on CEMS",
        "OSRM on OpenStreetMap (when routed)",
      ]
    );
  }

  if (/fire|police|ndrf|infrastructure|ambulance|helipad|relief/.test(q)) {
    const groups = {};
    for (const f of facilities) {
      groups[f.type] = groups[f.type] || [];
      groups[f.type].push(f);
    }
    const lines = Object.entries(groups).map(
      ([type, list]) => `${type.replaceAll("_", " ")}: ${list.length} (nearest ${list[0]?.name} at ${list[0]?.distanceKm} km)`
    );
    return cite(
      `Compiled emergency infrastructure near ${disaster.code}:\n${lines.join("\n") || "None in radius."}\n\nOperational status of each site is Unknown unless independently confirmed.`,
      ["OpenStreetMap / NDRF public locations (compiled seed)"]
    );
  }

  if (/summar|sitrep|damage|impact|what happen/.test(q)) {
    return cite(
      `${disaster.name} (${disaster.code}) is a ${disaster.category.toLowerCase()} affecting ${disaster.state || disaster.countries?.join(", ")}. ` +
        `Affected area ${disaster.affectedAreaKm2 ?? "Unknown"} km². ` +
        `Population in product statistics: estimated ${impact.populationEstimated ?? "Unknown"}, affected ${impact.populationAffected ?? "Unknown"}. ` +
        `Buildings affected: ${impact.buildingsAffected ?? "Unknown"}. Roads affected: ${impact.roadsAffectedKm ?? "Unknown"} km. ` +
        `${disaster.reason || ""} ` +
        `Source mode: ${disaster.mode}. This summary does not recommend deployments.`,
      [disaster.mode === "live" ? "Copernicus EMS Rapid Mapping" : disaster.source]
    );
  }

  return cite(
    "I can only answer from fused platform data: nearest hospitals, routed distances, compiled fire/police/NDRF layers, and Copernicus or demo impact statistics. Ask about hospitals, roads, infrastructure, or request a summary. I will not invent casualty figures, live bed counts, or operational orders.",
    ["NDRF Intelligence Assistant policy"]
  );
}
