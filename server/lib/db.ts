import "dotenv/config";
import WebSocket from "ws";
import {
  createClient,
  type SupabaseClient,
  type WebSocketLikeConstructor,
} from "@supabase/supabase-js";
import { supabaseConfig } from "./supabase-config.js";
// ws implements the runtime interface; its Node typings use different event overloads.
const transport = WebSocket as unknown as WebSocketLikeConstructor;
let client: SupabaseClient | undefined;
export const configured = () =>
  Boolean(supabaseConfig().url && supabaseConfig().secretKey);
export function db() {
  if (!configured())
    throw new Error(
      "Configure SUPABASE_URL and SUPABASE_SECRET_KEY to use live data.",
    );
  return (client ??= createClient(
    supabaseConfig().url!,
    supabaseConfig().secretKey!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport },
    },
  ));
}
export async function checked<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}
export async function insert(table: string, row: Record<string, unknown>) {
  return checked(db().from(table).insert(row).select().single());
}
export const now = () => new Date().toISOString();

/** Workspace creation must run as the signed-in user, through a public API key. */
export function userClient(authorization: string) {
  const { url, publishableKey } = supabaseConfig();
  if (!url || !publishableKey)
    throw new Error(
      "Configure VITE_SUPABASE_PUBLISHABLE_KEY to create workspaces.",
    );
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    realtime: { transport },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
