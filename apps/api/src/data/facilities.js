export const FACILITIES = [
  { id: "fs-mum-1", type: "fire_station", name: "Mumbai Fire Brigade HQ", state: "Maharashtra", district: "Mumbai", latitude: 18.938, longitude: 72.835, source: "OpenStreetMap / municipal records (compiled)" },
  { id: "fs-mum-2", type: "fire_station", name: "Byculla Fire Station", state: "Maharashtra", district: "Mumbai", latitude: 18.976, longitude: 72.833, source: "OpenStreetMap" },
  { id: "fs-mum-3", type: "fire_station", name: "Bandra Fire Station", state: "Maharashtra", district: "Mumbai", latitude: 19.055, longitude: 72.84, source: "OpenStreetMap" },
  { id: "ps-mum-1", type: "police", name: "Mumbai Police HQ", state: "Maharashtra", district: "Mumbai", latitude: 18.943, longitude: 72.834, source: "OpenStreetMap" },
  { id: "ps-mum-2", type: "police", name: "D.B. Marg Police Station", state: "Maharashtra", district: "Mumbai", latitude: 18.96, longitude: 72.82, source: "OpenStreetMap" },
  { id: "amb-mum-1", type: "ambulance", name: "108 Ambulance Hub Dadar", state: "Maharashtra", district: "Mumbai", latitude: 19.018, longitude: 72.843, source: "State EMS compiled" },
  { id: "amb-mum-2", type: "ambulance", name: "108 Ambulance Hub Andheri", state: "Maharashtra", district: "Mumbai", latitude: 19.119, longitude: 72.847, source: "State EMS compiled" },
  { id: "ndrf-mum", type: "ndrf", name: "NDRF 5th Battalion (Pune / western sector staging)", state: "Maharashtra", district: "Pune", latitude: 18.62, longitude: 73.8, source: "NDRF public battalion locations" },
  { id: "rel-mum-1", type: "relief_centre", name: "NESCO Exhibition Grounds relief staging", state: "Maharashtra", district: "Mumbai", latitude: 19.152, longitude: 72.853, source: "Municipal disaster plan compiled" },
  { id: "hel-mum-1", type: "helipad", name: "Juhu Aerodrome", state: "Maharashtra", district: "Mumbai", latitude: 19.098, longitude: 72.834, source: "OpenStreetMap" },

  { id: "fs-ghy-1", type: "fire_station", name: "Guwahati Fire & Emergency Services HQ", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.183, longitude: 91.745, source: "OpenStreetMap" },
  { id: "ps-ghy-1", type: "police", name: "Panbazar Police Station", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.187, longitude: 91.745, source: "OpenStreetMap" },
  { id: "amb-ghy-1", type: "ambulance", name: "108 Assam EMS Guwahati", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.16, longitude: 91.766, source: "State EMS compiled" },
  { id: "ndrf-ghy", type: "ndrf", name: "NDRF 1st Battalion Guwahati", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.144, longitude: 91.736, source: "NDRF public battalion locations" },
  { id: "rel-ghy-1", type: "relief_centre", name: "Chandrapur relief camp complex", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.23, longitude: 91.9, source: "ASDMA compiled" },
  { id: "hel-ghy-1", type: "helipad", name: "Lokpriya Gopinath Bordoloi International Airport", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.106, longitude: 91.586, source: "OpenStreetMap" },
  { id: "water-ghy-1", type: "water", name: "Brahmaputra water intake / treatment (Panbazar)", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.19, longitude: 91.74, source: "Municipal compiled" },
  { id: "pwr-ghy-1", type: "power", name: "Kahilipara grid substation", state: "Assam", district: "Kamrup Metropolitan", latitude: 26.144, longitude: 91.77, source: "OpenStreetMap" },

  { id: "fs-kochi-1", type: "fire_station", name: "Ernakulam Fire Station", state: "Kerala", district: "Ernakulam", latitude: 9.981, longitude: 76.275, source: "OpenStreetMap" },
  { id: "ps-kochi-1", type: "police", name: "Ernakulam Town South Police Station", state: "Kerala", district: "Ernakulam", latitude: 9.968, longitude: 76.285, source: "OpenStreetMap" },
  { id: "amb-kochi-1", type: "ambulance", name: "108 Kerala EMS Ernakulam", state: "Kerala", district: "Ernakulam", latitude: 9.991, longitude: 76.292, source: "State EMS compiled" },
  { id: "ndrf-kochi", type: "ndrf", name: "NDRF 4th Battalion (southern sector staging)", state: "Tamil Nadu", district: "Chennai", latitude: 13.082, longitude: 80.27, source: "NDRF public battalion locations" },
  { id: "rel-kochi-1", type: "relief_centre", name: "Jawaharlal Nehru Stadium relief staging", state: "Kerala", district: "Ernakulam", latitude: 10.0, longitude: 76.3, source: "KSDMA compiled" },
  { id: "hel-kochi-1", type: "helipad", name: "Cochin International Airport", state: "Kerala", district: "Ernakulam", latitude: 10.152, longitude: 76.401, source: "OpenStreetMap" },

  { id: "fs-bbsr-1", type: "fire_station", name: "Bhubaneswar Fire Station Unit 1", state: "Odisha", district: "Khordha", latitude: 20.27, longitude: 85.84, source: "OpenStreetMap" },
  { id: "ps-bbsr-1", type: "police", name: "Capital Police Station", state: "Odisha", district: "Khordha", latitude: 20.269, longitude: 85.831, source: "OpenStreetMap" },
  { id: "amb-bbsr-1", type: "ambulance", name: "108 Odisha EMS Bhubaneswar", state: "Odisha", district: "Khordha", latitude: 20.28, longitude: 85.82, source: "State EMS compiled" },
  { id: "ndrf-bbsr", type: "ndrf", name: "NDRF 3rd Battalion Mundali", state: "Odisha", district: "Cuttack", latitude: 20.47, longitude: 85.78, source: "NDRF public battalion locations" },
  { id: "rel-puri-1", type: "relief_centre", name: "Puri cyclone shelter cluster", state: "Odisha", district: "Puri", latitude: 19.8, longitude: 85.83, source: "OSDMA compiled" },
  { id: "hel-bbsr-1", type: "helipad", name: "Biju Patnaik International Airport", state: "Odisha", district: "Khordha", latitude: 20.244, longitude: 85.818, source: "OpenStreetMap" },

  { id: "fs-ddn-1", type: "fire_station", name: "Dehradun Fire Station", state: "Uttarakhand", district: "Dehradun", latitude: 30.316, longitude: 78.032, source: "OpenStreetMap" },
  { id: "ps-ddn-1", type: "police", name: "Dehradun Kotwali", state: "Uttarakhand", district: "Dehradun", latitude: 30.325, longitude: 78.043, source: "OpenStreetMap" },
  { id: "ndrf-ddn", type: "ndrf", name: "NDRF 14th Battalion Haridwar sector", state: "Uttarakhand", district: "Haridwar", latitude: 29.945, longitude: 78.164, source: "NDRF public battalion locations" },
  { id: "rel-jsm-1", type: "relief_centre", name: "Joshimath relief staging ground", state: "Uttarakhand", district: "Chamoli", latitude: 30.555, longitude: 79.56, source: "USDMA compiled" },
  { id: "hel-ddn-1", type: "helipad", name: "Jolly Grant Airport", state: "Uttarakhand", district: "Dehradun", latitude: 30.19, longitude: 78.18, source: "OpenStreetMap" },

  { id: "fs-sml-1", type: "fire_station", name: "Shimla Fire Station", state: "Himachal Pradesh", district: "Shimla", latitude: 31.104, longitude: 77.173, source: "OpenStreetMap" },
  { id: "ps-mdi-1", type: "police", name: "Mandi Sadar Police Station", state: "Himachal Pradesh", district: "Mandi", latitude: 31.708, longitude: 76.932, source: "OpenStreetMap" },
  { id: "ndrf-hp", type: "ndrf", name: "NDRF 7th Battalion Bhatinda (northern staging)", state: "Punjab", district: "Bathinda", latitude: 30.211, longitude: 74.945, source: "NDRF public battalion locations" },
  { id: "rel-mdi-1", type: "relief_centre", name: "Mandi district relief warehouse", state: "Himachal Pradesh", district: "Mandi", latitude: 31.71, longitude: 76.93, source: "HPSDMA compiled" },

  { id: "fs-chn-1", type: "fire_station", name: "Egmore Fire Station", state: "Tamil Nadu", district: "Chennai", latitude: 13.073, longitude: 80.261, source: "OpenStreetMap" },
  { id: "ps-chn-1", type: "police", name: "Chennai City Police HQ", state: "Tamil Nadu", district: "Chennai", latitude: 13.082, longitude: 80.27, source: "OpenStreetMap" },
  { id: "amb-chn-1", type: "ambulance", name: "108 Tamil Nadu EMS Chennai", state: "Tamil Nadu", district: "Chennai", latitude: 13.07, longitude: 80.25, source: "State EMS compiled" },
  { id: "ndrf-chn", type: "ndrf", name: "NDRF 4th Battalion Arakkonam", state: "Tamil Nadu", district: "Ranipet", latitude: 13.078, longitude: 79.67, source: "NDRF public battalion locations" },
  { id: "rel-chn-1", type: "relief_centre", name: "Nehru Indoor Stadium relief staging", state: "Tamil Nadu", district: "Chennai", latitude: 13.083, longitude: 80.271, source: "TNSDMA compiled" },
  { id: "hel-chn-1", type: "helipad", name: "Chennai International Airport", state: "Tamil Nadu", district: "Chennai", latitude: 12.994, longitude: 80.176, source: "OpenStreetMap" },

  { id: "fs-pat-1", type: "fire_station", name: "Patna Fire Station Gandhi Maidan", state: "Bihar", district: "Patna", latitude: 25.618, longitude: 85.141, source: "OpenStreetMap" },
  { id: "ps-pat-1", type: "police", name: "Gandhi Maidan Police Station", state: "Bihar", district: "Patna", latitude: 25.62, longitude: 85.144, source: "OpenStreetMap" },
  { id: "amb-pat-1", type: "ambulance", name: "108 Bihar EMS Patna", state: "Bihar", district: "Patna", latitude: 25.61, longitude: 85.14, source: "State EMS compiled" },
  { id: "ndrf-pat", type: "ndrf", name: "NDRF 9th Battalion Bihta", state: "Bihar", district: "Patna", latitude: 25.57, longitude: 84.87, source: "NDRF public battalion locations" },
  { id: "rel-pat-1", type: "relief_centre", name: "Gandhi Maidan relief distribution", state: "Bihar", district: "Patna", latitude: 25.62, longitude: 85.145, source: "BSDMA compiled" },

  { id: "gov-ndma", type: "government", name: "NDMA HQ", state: "Delhi", district: "New Delhi", latitude: 28.589, longitude: 77.229, source: "Government of India" },
  { id: "gov-mha", type: "government", name: "Ministry of Home Affairs", state: "Delhi", district: "New Delhi", latitude: 28.614, longitude: 77.209, source: "Government of India" }
].map((f) => ({
  ...f,
  sourceUpdated: "2026-09-30",
  operationalStatus: "Unknown",
}));

export const FACILITY_LABELS = {
  fire_station: "Fire station",
  police: "Police station",
  ambulance: "Ambulance facility",
  ndrf: "NDRF / response unit",
  relief_centre: "Relief centre",
  helipad: "Helipad / airfield",
  water: "Water infrastructure",
  power: "Power infrastructure",
  government: "Government facility",
};
