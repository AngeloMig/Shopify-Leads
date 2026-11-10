// The Local businesses export: one row per business, as a call sheet that
// opens cleanly in Excel or Google Sheets.
import {
  localTrades,
  socialLabel,
  websiteCheckLabel,
  type LocalBusiness,
} from "./local-business.js";
import { prospectScore, tierLabel, type Prospect } from "./local-prospect.js";
import { csvCell } from "./scoring.js";
import { countryNames } from "./types.js";

export type ExportedBusiness = LocalBusiness & { prospect?: Prospect };

const stageNames = {
  new: "New",
  contacted: "Contacted",
  won: "Won",
  lost: "Lost",
};
const tradeName = (id: string) =>
  localTrades.find((t) => t.id === id)?.label ?? id;
const mapLink = (b: LocalBusiness) =>
  b.osm_url ??
  (b.lat != null && b.lon != null
    ? `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lon}#map=18/${b.lat}/${b.lon}`
    : "");

export const localCsvHeader = [
  "Name",
  "Trade",
  "City",
  "Country",
  "Prospect",
  "Score",
  "Phone",
  "Email",
  "Address",
  "Opening hours",
  "Website check",
  "Website found",
  "Social pages",
  "Map",
  "Stage",
  "Notes",
  "Found on",
];

export function localCsvRow(b: ExportedBusiness): string[] {
  const prospect = b.prospect ?? prospectScore(b);
  return [
    b.name,
    tradeName(b.trade),
    b.city,
    countryNames[b.country] ?? b.country,
    tierLabel[prospect.tier],
    String(prospect.score),
    b.phone ?? "",
    b.email ?? "",
    b.address ?? "",
    b.opening_hours ?? "",
    websiteCheckLabel[b.website_check],
    b.found_site ?? "",
    // One page per network, as the list shows them.
    [...new Map(b.social_links.map((s) => [s.network, s])).values()]
      .map((s) => `${socialLabel[s.network]}: ${s.url}`)
      .join("; "),
    mapLink(b),
    stageNames[b.stage],
    b.notes,
    b.found_at.slice(0, 10),
  ];
}

/** The whole file: a BOM so Excel reads it as UTF-8, and CRLF line ends. */
export function localBusinessCsv(rows: ExportedBusiness[]) {
  return (
    "﻿" +
    [localCsvHeader, ...rows.map(localCsvRow)]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
