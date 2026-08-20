// City -> county -> territory mapping for auto-routing.
// Seeded with all Volusia (Fun Coast) and Brevard (Space Coast) cities,
// including common abbreviations and misspellings observed in the source data.
//
// If a city isn't in this list the account gets territory='unassigned'
// and surfaces in the admin queue for manual review.

type Row = {
  city: string;
  county: string;
  territory: "fun_coast" | "space_coast" | "unassigned";
};

const VOLUSIA: string[] = [
  "Daytona Beach",
  "Daytona Beach Shores",
  "DeBary",
  "Debary",
  "DeLand",
  "Deland",
  "Deltona",
  "Edgewater",
  "Holly Hill",
  "Lake Helen",
  "New Smyrna Beach",
  "Oak Hill",
  "Orange City",
  "Ormond Beach",
  "Ormond-by-the-Sea",
  "Pierson",
  "Ponce Inlet",
  "Port Orange",
  "South Daytona",
  "Glencoe",
  "Seville",
  "Barberville",
  "De Leon Springs",
  "Samsula",
  "Osteen",
  "Enterprise",
];

const BREVARD: string[] = [
  "Cape Canaveral",
  "Cocoa",
  "Cocoa Beach",
  "Grant-Valkaria",
  "Indialantic",
  "Indian Harbour Beach",
  "Indian Hrbr Bch",
  "Malabar",
  "Melbourne",
  "Melbourne Beach",
  "Melbourne Village",
  "West Melbourne",
  "Merritt Island",
  "Palm Bay",
  "Palm Shores",
  "Rockledge",
  "Satellite Beach",
  "Titusville",
  "Viera",
  "Port St. John",
  "Port St John",
  "Sharpes",
  "Mims",
  "Scottsmoor",
  "Micco",
  "Patrick SFB",
  "Patrick Space Force Base",
  "Kennedy Space Center",
];

export const CITY_MAPPINGS: Row[] = [
  ...VOLUSIA.map((c) => ({
    city: c,
    county: "Volusia",
    territory: "fun_coast" as const,
  })),
  ...BREVARD.map((c) => ({
    city: c,
    county: "Brevard",
    territory: "space_coast" as const,
  })),
];
