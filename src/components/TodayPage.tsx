import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, HardHat, Mail, Phone, ShieldCheck } from "lucide-react";
import {
  contactLabel,
  emailStepLabel,
  followUpLabel,
  isDue,
  nextEmailStep,
} from "../../shared/contact-log";
import { leadScoreFor } from "../../shared/lead-score";
import type { LocalBusiness } from "../../shared/local-business";
import { prospectScore, type Prospect } from "../../shared/local-prospect";
import type { Lead } from "../../shared/types";
import { demoLocalBusinesses } from "../demo";
import { api, formatDate } from "../lib";
import { Button } from "./ui/button";
import "../today.css";

type LocalRow = LocalBusiness & { prospect?: Prospect };
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Everything to do today, across Shopify leads and local businesses. */
export function TodayPage({
  leads,
  demo,
  onOpenLead,
  onStartReview,
}: {
  leads: Lead[];
  demo: boolean;
  onOpenLead: (lead: Lead) => void;
  onStartReview: () => void;
}) {
  const [local, setLocal] = useState<LocalRow[] | null>(null);
  useEffect(() => {
    if (demo) {
      setLocal(
        demoLocalBusinesses
          .filter(
            (b) => b.stage === "new" && prospectScore(b).tier === "strong",
          )
          .slice(0, 5),
      );
      return;
    }
    let current = true;
    api<{ rows: LocalRow[] }>(
      "/local-businesses?view=no_site&has=strong&sort=best&stage=new&size=5",
    )
      .then((r) => current && setLocal(r.rows))
      .catch(() => current && setLocal([]));
    return () => {
      current = false;
    };
  }, [demo]);

  const open = leads.filter((l) => !l.suppressed && !l.outcome);
  const due = open
    .filter((l) => isDue(l))
    .sort((a, b) =>
      (a.contact!.follow_up_at ?? "").localeCompare(
        b.contact!.follow_up_at ?? "",
      ),
    );
  const ready = open
    .filter((l) => l.permission === "approved" && !l.contact)
    .sort(
      (a, b) => leadScoreFor(b).researchScore - leadScoreFor(a).researchScore,
    )
    .slice(0, 8);
  const waitingLeads = open.filter((l) => l.permission === "unknown");
  const waiting = waitingLeads.length;
  // Priority A on research alone: the ones worth reviewing first.
  const strong = waitingLeads.filter(
    (l) => leadScoreFor(l).researchScore >= 70,
  ).length;
  const nothing = !due.length && !ready.length && !waiting && !local?.length;

  return (
    <div className="today">
      {waiting > 0 && (
        <section className="panel today-review">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>
              {waiting} {waiting === 1 ? "store is" : "stores are"} waiting for
              outreach review
              {strong > 0 && `, ${strong} of them Priority A`}
            </strong>
            <p>
              The strongest come first. Approved stores show up here, ready to
              email. Keys A, N and S make it quick.
            </p>
          </div>
          <Button onClick={onStartReview}>Start review</Button>
        </section>
      )}

      <section className="panel today-list" aria-labelledby="today-due">
        <header>
          <h2 id="today-due">
            <CalendarClock size={16} aria-hidden="true" /> Follow-ups due
          </h2>
          <span className="today-count">{due.length}</span>
        </header>
        {due.length ? (
          <ul>
            {due.map((l) => (
              <li key={l.id}>
                <button className="today-name" onClick={() => onOpenLead(l)}>
                  <strong>{l.name}</strong>
                  <small>
                    {contactLabel[l.contact!.kind]}{" "}
                    {formatDate(l.contact!.at, true)} · {l.contact!.touches}{" "}
                    {l.contact!.touches === 1 ? "touch" : "touches"}
                  </small>
                </button>
                <span className="today-when">
                  {followUpLabel(l.contact!.follow_up_at!)}
                  {l.contact!.kind === "emailed" &&
                    nextEmailStep(l.contact!.emails) && (
                      <small>
                        Send the{" "}
                        {emailStepLabel[
                          nextEmailStep(l.contact!.emails)!
                        ].toLowerCase()}
                      </small>
                    )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="today-empty">
            Nothing due. Log an email or call on a lead and its follow-up shows
            here on the day.
          </p>
        )}
      </section>

      <section className="panel today-list" aria-labelledby="today-ready">
        <header>
          <h2 id="today-ready">
            <Mail size={16} aria-hidden="true" /> Approved, not contacted yet
          </h2>
          <span className="today-count">{ready.length}</span>
        </header>
        {ready.length ? (
          <ul>
            {ready.map((l) => (
              <li key={l.id}>
                <button className="today-name" onClick={() => onOpenLead(l)}>
                  <strong>{l.name}</strong>
                  <small>
                    {l.industry} · {l.domain}
                  </small>
                </button>
                <span className="today-score">
                  {leadScoreFor(l).researchScore}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="today-empty">
            No approved store is waiting for a first email.
          </p>
        )}
      </section>

      <section className="panel today-list" aria-labelledby="today-local">
        <header>
          <h2 id="today-local">
            <HardHat size={16} aria-hidden="true" /> Local businesses to call
          </h2>
          <Link className="text-button" to="/local?has=strong">
            All strong prospects
          </Link>
        </header>
        {local === null ? (
          <p className="today-empty" role="status">
            Loading…
          </p>
        ) : local.length ? (
          <ul>
            {local.map((b) => (
              <li key={b.id}>
                <div className="today-name">
                  <strong>{b.name}</strong>
                  <small>
                    {b.trade} · {b.city}
                  </small>
                </div>
                {b.phone ? (
                  <a className="today-call" href={tel(b.phone)}>
                    <Phone size={14} aria-hidden="true" />
                    {b.phone}
                  </a>
                ) : (
                  <span className="today-score">
                    {(b.prospect ?? prospectScore(b)).score}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="today-empty">
            No new strong prospects. Run a search from Local businesses.
          </p>
        )}
      </section>

      {nothing && (
        <p className="today-empty">
          You're all caught up. Start a discovery to find more stores.
        </p>
      )}
    </div>
  );
}
