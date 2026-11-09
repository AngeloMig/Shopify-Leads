import { reportIssues } from "./audit-presentation.js";
import { explainFinding } from "./finding-explanation.js";
import {
  mailStatus,
  rankedEmails,
  shortBusinessName,
} from "./lead-intelligence.js";
import type { Finding, Lead } from "./types.js";
import {
  emptySender,
  matchingWork,
  offerLine,
  portfolioLabel,
  type Sender,
} from "./sender.js";
import type { EmailStep } from "./contact-log.js";

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
  /** The first email; `emails` has the whole three-email sequence. */
  email: { subject: string; body: string } | null;
  emails: Record<EmailStep, { subject: string; body: string }> | null;
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
> & {
  industry?: string;
  contact_name?: string | null;
  /** The service the lead panel leads with, so the email says the same. */
  focus_service?: string;
};
const withArticle = (s: string) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;
/** "Some text" → "some text", but JavaScript, Shopify and Google stay as they are. */
const lowerFirst = (s: string) => {
  const word = s.split(/\s/)[0];
  return /^[A-Z][a-z]+$/.test(word) && !/^(Shopify|Google)$/.test(word)
    ? s.charAt(0).toLowerCase() + s.slice(1)
    : s;
};
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
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
      emails: null,
      call: null,
    };
  // One verified finding, one service, one next step: the most serious first.
  const top = needs.find((n) => n.service === lead.focus_service) ?? needs[0];
  const problem = top.problems[0];
  const speed = /performance|image|asset|javascript/i.test(top.service);
  const scored =
    lead.performance === null
      ? null
      : `${lead.domain} scored ${Math.round(lead.performance)}/100 for mobile performance in Google PageSpeed${testedOn(lead.audited_at)}.`;
  const found = [
    ...(scored ? [scored] : []),
    ...needs.flatMap((n) => n.problems).slice(0, 3),
  ];
  const suggested = [
    top.service,
    ...needs.filter((n) => n !== top).map((n) => n.service),
  ].slice(0, 3);
  const firstName = lead.contact_name?.trim().split(/\s+/)[0];
  // "Tero · A studio for the bath" is a page title; people say "Tero".
  const hello = `Hi ${firstName || `${shortBusinessName(lead.name, lead.domain)} team`},`;
  const offer = offerLine(sender);
  const firstStep = offer
    ? `our ${lowerFirst(offer)}`
    : withArticle(lowerFirst(top.service));
  const signature = [
    me,
    company,
    sender.email,
    sender.phone,
    sender.address || "[Your business address]",
    work,
  ]
    .filter(Boolean)
    .join("\n");
  const booking = sender.booking_url
    ? `If it's easier to talk, you can pick a time here: ${sender.booking_url}`
    : "";
  const proof = similar
    ? `We recently worked on ${similar.title}, another ${similar.industry.toLowerCase()} store: ${similar.url}`
    : work
      ? `You can see some of our recent work at ${work}`
      : "";
  const subject = `Noticed on ${lead.domain}: ${lowerFirst(problem).replace(/\.$/, "")}`;
  const first = [
    hello,
    `I'm ${me} from ${company}. We work on Shopify stores, and we ran some public tests on ${lead.domain}.`,
    [
      `One thing stood out: ${sentence(lowerFirst(problem))}`,
      top.why,
      speed && scored ? scored : "",
    ]
      .filter(Boolean)
      .join(" "),
    `It's usually fixable without a redesign. A good first step would be ${firstStep}${offer && sender.offer_scope ? `: ${lowerFirst(sentence(sender.offer_scope))}` : "."}`,
    proof,
    "Would it be useful if I sent over the short report? If this isn't for you, just say so and I won't contact you again.",
    booking,
    signature,
  ]
    .filter(Boolean)
    .join("\n\n");
  const followUp = [
    hello,
    `Following up on my note about ${lead.domain}. ${sentence(`The main thing we found: ${lowerFirst(problem)}`)}`,
    `A useful first step would be ${firstStep}, rather than assuming a full redesign is needed.`,
    "Is this relevant to what you're working on at the moment? If not, just say so and I won't contact you again.",
    booking,
    signature,
  ]
    .filter(Boolean)
    .join("\n\n");
  const final = [
    hello,
    `I'll close the loop on this for now. My note was about ${lowerFirst(problem).replace(/\.$/, "")} on ${lead.domain}, and ${lowerFirst(top.service)} is work we do for Shopify stores.`,
    "No reply needed if it isn't a priority. If it becomes one, I'm happy to send the short report.",
    booking,
    "This is my last note, so I won't contact you again about it.",
    signature,
  ]
    .filter(Boolean)
    .join("\n\n");
  const emails = {
    first: { subject, body: first },
    follow_up: { subject, body: followUp },
    final: { subject, body: final },
  };
  return {
    needs,
    toConfirm,
    questions,
    contact,
    email: emails.first,
    emails,
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
        text: `${offer ? `A good first step is ${firstStep}.` : `We could look at ${suggested[0].charAt(0).toLowerCase()}${suggested[0].slice(1)}.`} Can I send you the short report?${similar ? ` We did similar work for ${similar.title}, another ${similar.industry.toLowerCase()} store.` : work ? ` You can also see sites we've built at ${portfolioLabel(work)}.` : ""}`,
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
