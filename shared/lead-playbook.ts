import { reportIssues } from "./audit-presentation.js";
import { explainFinding } from "./finding-explanation.js";
import { mailStatus, rankedEmails } from "./lead-intelligence.js";
import type { Finding, Lead } from "./types.js";
import {
  emptySender,
  matchingWork,
  portfolioLabel,
  type Sender,
} from "./sender.js";

export type PlanNeed = {
  service: string;
  severity: Finding["severity"];
  /** Plain-language problems, as a store owner would read them. */
  problems: string[];
  why: string;
  steps: string[];
  check: string;
};
export type LeadPlaybook = {
  needs: PlanNeed[];
  /** Unverified ideas: things to ask about, never things to claim. */
  toConfirm: string[];
  questions: string[];
  contact: string | null;
  email: { subject: string; body: string } | null;
  call: { label: string; text: string }[] | null;
};
type PlaybookLead = Pick<
  Lead,
  | "name"
  | "domain"
  | "findings"
  | "performance"
  | "audited_at"
  | "emails"
  | "preferred_email"
  | "mail_checks"
  | "contact_url"
> & { industry?: string };
const weight = { high: 0, medium: 1, low: 2 };
const testedOn = (at: string | null) =>
  at
    ? ` when we tested it on ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(at))}`
    : "";
const questionsFor = (needs: PlanNeed[]) => [
  ...(needs.some((n) => /performance|image|asset/i.test(n.service))
    ? ["Have customers mentioned the site feeling slow on their phones?"]
    : []),
  ...(needs.some((n) => /accessib/i.test(n.service))
    ? ["Has anyone reviewed the store for accessibility recently?"]
    : []),
  "Who looks after your theme and apps today?",
  "Is anything on the site already being changed this quarter?",
  "What would you most like the website to do better?",
];
/**
 * List views can carry findings with no text at all; a plan needs the full evidence.
 * One blank finding among real ones isn't that, so it can't leave the tab waiting.
 */
export const hasFullEvidence = (lead: Pick<Lead, "findings">) =>
  !lead.findings.length || lead.findings.some((f) => !!f.url || !!f.evidence);
/**
 * What this store needs and what to say about it, from saved evidence alone. Only
 * verified findings reach the script, and it claims no sales or revenue effects.
 */
export function leadPlaybook(
  lead: PlaybookLead,
  sender: Sender = emptySender,
): LeadPlaybook {
  // Your details where they're set, placeholders to fill in where they aren't.
  const me = sender.name || "[Your name]";
  const company = sender.company || "[Your company]";
  const work = sender.portfolio_url;
  // A project in the same industry says more than a whole portfolio.
  const similar = matchingWork(sender, lead.industry ?? "");
  const issues = reportIssues(lead.findings, []);
  const plain = (issue: (typeof issues)[number]) =>
    explainFinding(issue, lead.findings, []);
  const groups = new Map<string, PlanNeed>();
  for (const issue of issues.filter((i) => i.kind === "verified")) {
    const text = plain(issue);
    const need = groups.get(issue.service);
    if (need) {
      need.problems.push(text.title);
      if (!need.steps.includes(text.action)) need.steps.push(text.action);
      if (weight[issue.severity] < weight[need.severity])
        need.severity = issue.severity;
    } else
      groups.set(issue.service, {
        service: issue.service,
        severity: issue.severity,
        problems: [text.title],
        why: text.meaning,
        steps: [text.action],
        check: text.validation,
      });
  }
  const needs = [...groups.values()].sort(
    (a, b) => weight[a.severity] - weight[b.severity],
  );
  const toConfirm = issues
    .filter((i) => i.kind !== "verified")
    .map((i) => plain(i).title);
  const best = rankedEmails(
    lead.emails,
    lead.preferred_email,
    lead.mail_checks,
  ).find((e) => mailStatus(e.email, lead.mail_checks) !== "none");
  const questions = questionsFor(needs);
  const contact = best?.email ?? lead.contact_url ?? null;
  if (!needs.length)
    return {
      needs,
      toConfirm,
      questions,
      contact,
      email: null,
      call: null,
    };
  const scored =
    lead.performance === null
      ? null
      : `${lead.domain} scored ${Math.round(lead.performance)}/100 for mobile performance in Google PageSpeed${testedOn(lead.audited_at)}.`;
  const found = [
    ...(scored ? [scored] : []),
    ...needs.flatMap((n) => n.problems).slice(0, 3),
  ];
  const suggested = needs.slice(0, 3).map((n) => n.service);
  return {
    needs,
    toConfirm,
    questions,
    contact,
    email: {
      subject: `A few things we noticed on ${lead.domain}`,
      body: [
        `Hi ${lead.name} team,`,
        `I'm ${me} from ${company}. We work on Shopify stores, and we ran some public tests on ${lead.domain}.`,
        `Here's what we found:\n${found.map((f) => `- ${f}`).join("\n")}`,
        `Where we could help:\n${suggested.map((s) => `- ${s}`).join("\n")}`,
        ...(similar
          ? [
              `We recently worked on ${similar.title}, another ${similar.industry.toLowerCase()} store: ${similar.url}`,
            ]
          : work
            ? [`You can see some of our recent work at ${work}`]
            : []),
        "Would it be useful if I sent over the short report? If this isn't for you, just say so and I won't contact you again.",
        [me, company, sender.address || "[Your business address]", work]
          .filter(Boolean)
          .join("\n"),
      ].join("\n\n"),
    },
    call: [
      {
        label: "Open",
        text: `Hi, this is ${me} from ${company}. Could I speak with whoever looks after the ${lead.name} website?`,
      },
      {
        label: "Why you're calling",
        text: `We work on Shopify stores, and we ran some public tests on ${lead.domain}. Do you have a minute for what we found?`,
      },
      {
        label: "What you found",
        text: found
          .slice(0, 2)
          .map((f) => (f.endsWith(".") ? f : `${f}.`))
          .join(" "),
      },
      { label: "Ask", text: questions[0] },
      {
        label: "Next step",
        text: `We could look at ${suggested[0].charAt(0).toLowerCase()}${suggested[0].slice(1)}. Can I send you the short report?${similar ? ` We did similar work for ${similar.title}, another ${similar.industry.toLowerCase()} store.` : work ? ` You can also see sites we've built at ${portfolioLabel(work)}.` : ""}`,
      },
      {
        label: "If they say no",
        text: "No problem, thanks for your time. I'll make sure we don't contact you again.",
      },
    ],
  };
}
/** Everything the plan says, for pasting into a proposal or a ticket. */
export const planText = (lead: Pick<Lead, "name">, plan: LeadPlaybook) =>
  [
    `What ${lead.name} needs`,
    ...plan.needs.map((n) =>
      [
        `\n${n.service}`,
        ...n.problems.map((p) => `Problem: ${p}`),
        ...n.steps.map((s) => `To do: ${s}`),
        `How to check: ${n.check}`,
      ].join("\n"),
    ),
  ].join("\n");
export const callText = (plan: LeadPlaybook) =>
  (plan.call ?? []).map((c) => `${c.label}: ${c.text}`).join("\n\n");
