import test from "node:test";
import assert from "node:assert/strict";
import {
  assignDistinctRecommendations,
  rankHospitalCandidates,
  rankNearestRoadCandidates,
  rankNearestRoutedCandidates,
} from "../src/services/hospitalRanking.js";

function candidate(id, durationMin, roadKm, emergency = true) {
  return {
    hospital: {
      id,
      emergency,
      operationalStatus: "Unknown",
    },
    durationMin,
    roadKm,
    routeReachable: true,
  };
}

test("ranks by road time and distance, never stale directory bed counts", () => {
  const ranked = rankHospitalCandidates([
    { ...candidate("near-by-road", 40, 30), hospital: { ...candidate("near-by-road", 40, 30).hospital, beds: 9000 } },
    { ...candidate("fastest-road", 20, 37), hospital: { ...candidate("fastest-road", 20, 37).hospital, beds: 10 } },
  ]);
  assert.equal(ranked[0].hospital.id, "fastest-road");
  assert.equal(ranked[0].scoreBreakdown.availability, 0.05);
});

test("omits candidates without complete positive road-network metrics", () => {
  const ranked = rankHospitalCandidates([
    candidate("good", 12, 8),
    candidate("no-time", null, 4),
    candidate("no-distance", 8, null),
    candidate("zero", 0, 0),
  ]);
  assert.deepEqual(ranked.map(({ hospital }) => hospital.id), ["good"]);
});

test("proposes distinct hospitals for separate clusters where candidates allow", () => {
  const assignments = assignDistinctRecommendations([
    {
      id: "cluster-a",
      severity: "moderate",
      candidates: rankHospitalCandidates([candidate("shared", 10, 5), candidate("hospital-a", 14, 7)]),
    },
    {
      id: "cluster-b",
      severity: "critical",
      candidates: rankHospitalCandidates([candidate("shared", 11, 6), candidate("hospital-b", 15, 8)]),
    },
  ]);
  assert.equal(assignments.get("cluster-b"), "shared");
  assert.equal(assignments.get("cluster-a"), "hospital-a");
});

test("nearest validated local hospital takes priority regardless of size or emergency listing", () => {
  const nearbySmall = {
    ...candidate("local-clinic", 22, 6, false),
    geographicKm: 2.1,
    routeGeometry: { type: "LineString", coordinates: [[72.82, 19.02], [72.83, 19.03]] },
  };
  const fartherTertiary = {
    ...candidate("tertiary-center", 14, 11, true),
    geographicKm: 5.4,
    routeGeometry: { type: "LineString", coordinates: [[72.81, 19.01], [72.86, 19.05]] },
  };
  const nearest = rankNearestRoutedCandidates([fartherTertiary, nearbySmall]);
  assert.equal(nearest[0].hospital.id, "local-clinic");
});

test("road-matrix candidate selection keeps the nearest small local facility ahead of tertiary hospitals", () => {
  const nearbySmall = { ...candidate("local-hospital", 19, 3.8, false), geographicKm: 2.2 };
  const fartherTertiary = { ...candidate("tertiary-center", 16, 8.3, true), geographicKm: 4.9 };
  const ranked = rankNearestRoadCandidates([fartherTertiary, nearbySmall]);
  assert.equal(ranked[0].hospital.id, "local-hospital");
});
