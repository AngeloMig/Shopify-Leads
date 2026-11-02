import type { PublicEmail } from "../../shared/types.js";
import { checked, db, insert } from "./db.js";

/** Keep a source for every address and avoid duplicate rows on repeat audits. */
export async function savePublicEmails(
  organization_id: string,
  store_id: string,
  emails: PublicEmail[],
  checkpoint: () => Promise<void> = async () => {},
) {
  if (!emails.length) return;
  await checkpoint();
  const existing = await checked(
    db()
      .from("contacts")
      .select("route")
      .eq("organization_id", organization_id)
      .eq("store_id", store_id),
  );
  const routes = new Set(
    existing.map((contact) => contact.route.toLowerCase()),
  );
  for (const email of emails) {
    const route = `mailto:${email.email}`;
    if (routes.has(route)) continue;
    await checkpoint();
    await insert("contacts", {
      organization_id,
      store_id,
      route,
      role: "Public business email",
      source_url: email.source_url,
    });
    routes.add(route);
  }
}
