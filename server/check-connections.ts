import "dotenv/config";
import { db, checked } from "./lib/db.js";
import { supabaseConfig } from "./lib/supabase-config.js";
async function main() {
  const { url, secretKey, publishableKey } = supabaseConfig();
  if (!url || !secretKey || !publishableKey)
    throw new Error(
      "Fill SUPABASE_URL, SUPABASE_SECRET_KEY, VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env first.",
    );
  if (
    process.env.VITE_SUPABASE_URL?.replace(/\/$/, "") !== url.replace(/\/$/, "")
  )
    throw new Error(
      "VITE_SUPABASE_URL and SUPABASE_URL must use the same project URL.",
    );
  const auth = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!auth.ok)
    throw new Error(
      `Public Auth connection failed (${auth.status}). Check the project URL and publishable key.`,
    );
  const settings = await auth.json();
  if (!settings.external?.email)
    throw new Error(
      "Supabase Auth is reachable, but email/password sign-in is not enabled.",
    );
  console.info("PASS: public project key and email authentication.");
  await checked(db().from("organizations").select("id").limit(1));
  await checked(db().from("automation_jobs").select("id").limit(1));
  await checked(db().from("audit_metrics").select("environment").limit(1));
  console.info("PASS: server key, application tables and database grants.");
  await checked(db().storage.getBucket("audit-artifacts"));
  console.info("PASS: audit-artifacts storage bucket.");
  console.info(
    `Discovery keys configured: Store Leads ${process.env.STORE_LEADS_API_KEY ? "yes" : "no"}, Brave ${process.env.BRAVE_SEARCH_API_KEY ? "yes" : "no"}, Tavily ${process.env.TAVILY_API_KEY?.trim() ? "yes" : "no"}.`,
  );
  console.info(
    `PageSpeed key configured: ${process.env.PAGESPEED_API_KEY ? "yes" : "no"}. Optional OpenAI key: ${process.env.OPENAI_API_KEY ? "yes" : "no"}.`,
  );
  console.info(
    "Provider flags indicate key presence only. No paid provider requests, jobs, or data writes were performed.",
  );
}
void main().catch((error) => {
  console.error(
    "Connection check failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
