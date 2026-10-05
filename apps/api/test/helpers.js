export function squarePolygon(longitude, latitude, halfSize = 0.002) {
  return {
    type: "Polygon",
    coordinates: [[
      [longitude - halfSize, latitude - halfSize],
      [longitude + halfSize, latitude - halfSize],
      [longitude + halfSize, latitude + halfSize],
      [longitude - halfSize, latitude + halfSize],
      [longitude - halfSize, latitude - halfSize],
    ]],
  };
}

export function testDisaster(geometry = squarePolygon(82.8, 22.5, 0.1)) {
  return {
    code: "TEST-ACTIVATION",
    name: "Test activation",
    severity: "high",
    impact: { populationAffected: 100000 },
    aois: [{ number: 1, name: "Test AOI", extentGeoJSON: geometry }],
  };
}
