import { describe, it, expect } from "vitest";
import {
  localBusinessCsv,
  localCsvHeader,
  localCsvRow,
  type ExportedBusiness,
} from "../shared/local-business-csv";

const business = (patch: Partial<ExportedBusiness> = {}): ExportedBusiness => ({
  id: "b1",
  place_id: "p1",
  trade: "electrician",
  city: "Austin, TX",
  country: "US",
  name: "Ridgeway Electric",
  address: "1 Sample St, Austin, TX",
  phone: "+1 555 010 0000",
  email: null,
  opening_hours: "Mo-Fr 07:00-17:00",
  lat: 30.27,
  lon: -97.74,
  osm_url: null,
  website_check: "no_site_found",
  found_site: null,
  check_query: null,
  social_links: [
    { network: "facebook", url: "https://facebook.com/ridgeway" },
    { network: "facebook", url: "https://facebook.com/ridgeway-2" },
    { network: "instagram", url: "https://instagram.com/ridgeway" },
  ],
  stage: "contacted",
  notes: 'Called, said "send info"',
  suppressed: false,
  found_at: "2026-11-02T10:00:00Z",
  ...patch,
});

describe("Local businesses CSV", () => {
  it("writes one readable row per business", () => {
    const row = localCsvRow(business());
    const cell = (name: string) => row[localCsvHeader.indexOf(name)];
    expect(row).toHaveLength(localCsvHeader.length);
    expect(cell("Country")).toBe("United States");
    expect(cell("Stage")).toBe("Contacted");
    expect(cell("Website check")).toBe("No website found");
    expect(cell("Prospect")).toMatch(/prospect$/);
    expect(Number(cell("Score"))).toBeGreaterThan(0);
    expect(cell("Social pages")).toBe(
      "Facebook: https://facebook.com/ridgeway-2; Instagram: https://instagram.com/ridgeway",
    );
    expect(cell("Map")).toContain("mlat=30.27");
    expect(cell("Found on")).toBe("2026-11-02");
  });

  it("opens cleanly in a spreadsheet", () => {
    const csv = localBusinessCsv([
      business(),
      business({ id: "b2", name: '=HYPERLINK("x")', notes: "" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('"Name","Trade"')).toBe(true);
    expect(lines[1]).toContain('"Called, said ""send info"""');
    // A cell that starts like a formula is written as text.
    expect(lines[2].startsWith(`"'=HYPERLINK`)).toBe(true);
  });
});
