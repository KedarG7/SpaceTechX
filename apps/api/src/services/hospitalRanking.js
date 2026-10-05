const DEFAULT_WEIGHTS = {
  travelTime: 0.4,
  roadDistance: 0.2,
  severity: 0.1,
  emergencyCapability: 0.1,
  availability: 0.1,
  roadAccessibility: 0.1,
};

function configuredWeights() {
  const entries = Object.entries(DEFAULT_WEIGHTS).map(([key, fallback]) => {
    const envKey = `ROUTE_WEIGHT_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    const value = Number(process.env[envKey]);
    return [key, Number.isFinite(value) && value >= 0 ? value : fallback];
  });
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return Object.fromEntries(entries.map(([key, weight]) => [key, total ? weight / total : 0]));
}

function normalize(value, values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || !finiteValues.length) return 1;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  return max === min ? 0 : (value - min) / (max - min);
}

function severityPriority(severity = "unknown") {
  return ({ critical: 4, high: 3, moderate: 2, low: 1 })[severity.toLowerCase()] || 0;
}

export function rankHospitalCandidates(candidates, { severity = "unknown", weights = configuredWeights() } = {}) {
  const times = candidates.map((candidate) => candidate.durationMin);
  const distances = candidates.map((candidate) => candidate.roadKm);
  const snapDistances = candidates.map((candidate) => {
    const snap = candidate.routeSnapDistanceKm;
    return Number.isFinite(snap?.origin) && Number.isFinite(snap?.destination)
      ? snap.origin + snap.destination
      : null;
  });
  const severityRank = severityPriority(severity);
  const severityFactor = severityRank >= 3 ? 1.25 : 1;
  const timeWeight = weights.travelTime * severityFactor;
  const adjustedTotal = timeWeight +
    weights.roadDistance +
    weights.severity +
    weights.emergencyCapability +
    weights.availability +
    weights.roadAccessibility;

  return candidates
    .filter((candidate) =>
      Number.isFinite(candidate.durationMin) &&
      candidate.durationMin > 0 &&
      Number.isFinite(candidate.roadKm) &&
      candidate.roadKm > 0
    )
    .map((candidate) => {
      const breakdown = {
        travelTime: (normalize(candidate.durationMin, times) * timeWeight) / adjustedTotal,
        roadDistance: (normalize(candidate.roadKm, distances) * weights.roadDistance) / adjustedTotal,
        severity: ((4 - severityRank) / 4) * weights.severity / adjustedTotal,
        emergencyCapability:
          (candidate.hospital.emergency === true ? 0 : 1) *
          weights.emergencyCapability / adjustedTotal,
        availability:
          (candidate.hospital.operationalStatus === "Operational"
            ? 0
            : candidate.hospital.operationalStatus === "Closed"
              ? 1
              : 0.5) *
          weights.availability / adjustedTotal,
        roadAccessibility:
          normalize(
            Number.isFinite(candidate.routeSnapDistanceKm?.origin) &&
              Number.isFinite(candidate.routeSnapDistanceKm?.destination)
              ? candidate.routeSnapDistanceKm.origin + candidate.routeSnapDistanceKm.destination
              : null,
            snapDistances
          ) *
          weights.roadAccessibility / adjustedTotal,
      };
      const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
      return {
        ...candidate,
        score: Number(score.toFixed(4)),
        scoreBreakdown: Object.fromEntries(
          Object.entries(breakdown).map(([key, value]) => [key, Number(value.toFixed(4))])
        ),
        scoreWeights: {
          ...weights,
          travelTime: Number((timeWeight / adjustedTotal).toFixed(4)),
        },
        severityPriority: severityPriority(severity),
      };
    })
    .sort((left, right) =>
      left.score - right.score ||
      left.durationMin - right.durationMin ||
      left.roadKm - right.roadKm
    );
}

export function assignDistinctRecommendations(clusters) {
  const ordered = [...clusters].sort((a, b) =>
    severityPriority(b.severity) - severityPriority(a.severity) ||
    (a.candidates[0]?.score ?? Infinity) - (b.candidates[0]?.score ?? Infinity)
  );
  const assigned = new Set();
  const assignments = new Map();

  for (const cluster of ordered) {
    const candidate =
      cluster.candidates.find((entry) => !assigned.has(entry.hospital.id)) ||
      cluster.candidates[0];
    if (!candidate) continue;
    assigned.add(candidate.hospital.id);
    assignments.set(cluster.id, candidate.hospital.id);
  }
  return assignments;
}

export function routeScoringWeights() {
  return configuredWeights();
}
