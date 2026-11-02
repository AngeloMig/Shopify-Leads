import { LoaderCircle, Square } from "lucide-react";
import { Button } from "./ui/button";

export function DiscoveryControls({
  scheduled,
  busy,
  stopping,
  onStop,
}: {
  scheduled: boolean;
  busy: boolean;
  stopping: boolean;
  onStop: () => void;
}) {
  return (
    <div className="discovery-controls">
      <div>
        <strong>Scheduled discovery is {scheduled ? "on" : "off"}</strong>
        <p>
          Stop queued and running discovery and turn off all discovery
          schedules. Audits already queued continue; cancel them in Automation
          Jobs.
        </p>
        <small>
          A provider request already in progress may finish and count toward
          usage.
        </small>
      </div>
      <Button variant="danger" size="sm" disabled={busy} onClick={onStop}>
        {stopping ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Square size={14} />
        )}
        {stopping ? "Stopping…" : "Stop discovery"}
      </Button>
    </div>
  );
}
