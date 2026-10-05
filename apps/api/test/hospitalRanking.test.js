import test from "node:test";
import assert from "node:assert/strict";
import {
  assignDistinctRecommendations,
  rankHospitalCandidates,
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
