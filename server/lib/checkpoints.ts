import { createHash } from "node:crypto";
import { checked, db } from "./db.js";
import type { Job, PsiSample } from "../../shared/types.js";
export const checkpointSignature = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function reusableSample(
  row: { signature: string; result: unknown; saved_at: string } | null,
  signature: string,
  strategy: string,
  sample: number,
  now = Date.now(),
): row is { signature: string; result: PsiSample; saved_at: string } {
  if (
    !row ||
    row.signature !== signature ||
    !Number.isFinite(Date.parse(row.saved_at)) ||
    now - Date.parse(row.saved_at) > 86400000 ||
    Date.parse(row.saved_at) > now + 60000
  )
    return false;
  const r = row.result as PsiSample;
  return (
    !!r &&
    r.strategy === strategy &&
    r.sample === sample &&
    typeof r.url === "string" &&
    typeof r.tested_at === "string" &&
    !!r.scores &&
    !!r.field_data &&
    !!r.diagnostics
  );
}
export async function checkpointedPageSpeed(
  job: Job & { organization_id: string; worker_id: string },
  url: string,
  strategy: "mobile" | "desktop",
  sample: number,
  run: () => Promise<PsiSample>,
  checkpoint: () => Promise<void>,
  onReuse: () => Promise<void>,
) {
  const signature = checkpointSignature({
    version: "psi-v5-default-v1",
    url,
    strategy,
    sample,
  });
  const step = `pagespeed:${strategy}:${sample}`;
  await checkpoint();
  const saved = await checked(
    db()
      .from("job_checkpoints")
      .select("signature,result,saved_at")
      .eq("organization_id", job.organization_id)
      .eq("job_id", job.id)
      .eq("step", step)
      .maybeSingle(),
  );
  if (reusableSample(saved, signature, strategy, sample)) {
    await checkpoint();
    await onReuse();
    return saved.result;
  }
  const result = await run();
  await checkpoint();
  await checked(
    db().rpc("save_job_checkpoint", {
      org: job.organization_id,
      job: job.id,
      worker: job.worker_id,
      step_name: step,
      request_signature: signature,
      value: result,
    }),
  );
  return result;
}
