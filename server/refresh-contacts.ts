import { checked, db, now } from "./lib/db.js";
import { savePublicEmails } from "./lib/contacts.js";
import { CrawlSession } from "./lib/network.js";
import { inspectHtml } from "./modules/html-audit.js";
import { scanContactPages } from "./modules/contact-audit.js";

// Enrich existing leads without rerunning PageSpeed or generating another report.
// Scope is explicit so a maintenance run cannot accidentally scan every tenant.
const organization_id = process.argv[2];
if (!organization_id || !/^[\da-f-]{36}$/i.test(organization_id)) {
  throw new Error("Usage: npm run refresh:contacts -- <organization UUID>");
}
const leads = await checked(
  db().from("leads").select("store_id").eq("organization_id", organization_id),
);
const missingOnly = process.argv.includes("--missing-only");
const contacts = await checked(
  db()
    .from("contacts")
    .select("store_id,route")
    .eq("organization_id", organization_id),
);
let scanned = 0,
  enriched = 0;
for (const { store_id } of leads) {
  if (
    missingOnly &&
    contacts.some((c) => c.store_id === store_id && /^mailto:/i.test(c.route))
  )
    continue;
  const store = await checked(
    db()
      .from("discovered_stores")
      .select("domain,contact_url")
      .eq("organization_id", organization_id)
      .eq("id", store_id)
      .single(),
  );
  try {
    scanned++;
    const crawl = new CrawlSession();
    const home = await crawl.fetch(`https://${store.domain}`);
    if (
      home.status >= 400 ||
      !home.headers["content-type"]?.includes("text/html")
    )
      throw new Error(`Homepage unavailable (${home.status})`);
    const homepage = inspectHtml(home.body.toString(), home.url);
    const emails = [...homepage.emails];
    const scan = await scanContactPages(crawl, home, {
      knownContactUrl: store.contact_url,
    });
    emails.push(...scan.pages.flatMap((p) => p.emails));
    await savePublicEmails(organization_id, store_id, emails);
    if (emails.length) enriched++;
    if (!store.contact_url && (homepage.contact_url || emails[0]))
      await checked(
        db()
          .from("discovered_stores")
          .update({
            contact_url: homepage.contact_url ?? `mailto:${emails[0].email}`,
            researched_at: now(),
          })
          .eq("organization_id", organization_id)
          .eq("id", store_id),
      );
    console.info(
      `${store.domain}: ${new Set(emails.map((email) => email.email)).size} public email(s) saved.`,
    );
    for (const error of scan.errors)
      console.warn(`${store.domain}: ${error.url}: ${error.message}`);
  } catch (error) {
    console.error(
      `${store.domain}: ${error instanceof Error ? error.message : "Contact refresh failed"}`,
    );
    process.exitCode = 1;
  }
}
console.info(
  `Contact refresh: ${scanned} stores scanned; ${enriched} with public email evidence.`,
);
