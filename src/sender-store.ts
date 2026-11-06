// Your outreach details, loaded once and shared by every script that uses
// them. The demo workspace keeps them in this browser only.
import { useEffect, useState } from "react";
import { api } from "./lib";
import { emptySender, readSender, type Sender } from "../shared/sender";

const demoKey = "scout-demo-sender";
let cached: { demo: boolean; sender: Sender } | null = null;
const listeners = new Set<(s: Sender) => void>();

function readDemo(): Sender {
  try {
    return readSender(JSON.parse(localStorage.getItem(demoKey) ?? "{}"));
  } catch {
    return emptySender;
  }
}

async function load(demo: boolean): Promise<Sender> {
  if (cached?.demo === demo) return cached.sender;
  const sender = demo
    ? readDemo()
    : await api<Sender>("/sender")
        .then(readSender)
        .catch(() => emptySender);
  cached = { demo, sender };
  return sender;
}

export async function saveSender(demo: boolean, next: Sender) {
  const sender = demo
    ? next
    : readSender(await api<Sender>("/sender", next, "PUT"));
  if (demo)
    try {
      localStorage.setItem(demoKey, JSON.stringify(sender));
    } catch {
      /* A private window can't keep it; it still applies until reload. */
    }
  cached = { demo, sender };
  for (const listen of listeners) listen(sender);
  return sender;
}

/** Your details, and whether they've loaded yet. */
export function useSender(demo: boolean) {
  const [sender, setSender] = useState<Sender | null>(
    cached?.demo === demo ? cached.sender : null,
  );
  useEffect(() => {
    let current = true;
    void load(demo).then((s) => current && setSender(s));
    const listen = (s: Sender) => setSender(s);
    listeners.add(listen);
    return () => {
      current = false;
      listeners.delete(listen);
    };
  }, [demo]);
  return sender;
}
