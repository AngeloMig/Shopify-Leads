import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, checked } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { savedReportInput, publishSavedReport } from "./lib/stored-report.js";
import { createReport } from "./modules/report.js";
const organization_id = uuid.parse(process.argv[2]);
const publish = process.argv.includes("--publish");
const selected = process.argv
  .find((value) => value.startsWith("--report="))
  ?.slice(9);
let query = db()
  .from("reports")
  .select("id")
  .eq("organization_id", organization_id);
if (selected) query = query.eq("id", uuid.parse(selected));
const reports = await checked(query);
await mkdir("output/pdf", { recursive: true });
for (const report of reports) {
  const source = await savedReportInput(organization_id, report.id);
  const pdf = await createReport(source.input);
  const filename = path.resolve(
    "output/pdf",
    `${source.input.domain.replace(/[^a-z0-9.-]/gi, "_")}-audit.pdf`,
  );
  await writeFile(filename, pdf);
  if (publish)
    await publishSavedReport(organization_id, report.id, source, pdf);
  console.info(
    `${publish ? "Published" : "Preview"}: ${filename} (${pdf.length} bytes)`,
  );
}
