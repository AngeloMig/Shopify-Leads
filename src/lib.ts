import { createClient } from "@supabase/supabase-js";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { requestJson } from "./api-request";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase =
  import.meta.env.VITE_SUPABASE_URL && publishableKey
    ? createClient(import.meta.env.VITE_SUPABASE_URL, publishableKey)
    : null;
export async function api<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  return requestJson<T>(`/api${url}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export const formatDate = (value: string | null, short = false) =>
  value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        ...(short ? {} : { year: "numeric" }),
      }).format(new Date(value))
    : "Not audited";
export const number = (value: number) =>
  new Intl.NumberFormat("en").format(value);
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
