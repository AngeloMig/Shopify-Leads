import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  LayoutDashboard,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Wrench,
  HardHat,
  Store,
  Target,
  TrendingUp,
  Workflow,
  X,
  AlertCircle,
  CalendarDays,
  Mail,
  LockKeyhole,
  PlugZap,
} from "lucide-react";
import { hasFrontendOpportunity } from "../shared/lead-intelligence";
import { demoAlerts, demoSnapshot } from "./demo";
import { AutomationOrb } from "./components/AutomationOrb";
import { AutomationPage } from "./components/AutomationPage";
import { OutreachReview } from "./components/OutreachReview";
import { leadScoreFor } from "../shared/lead-score";
import type { AlertFeed } from "../shared/alerts";
import { api, supabase, number, formatDate, downloadBlob } from "./lib";
import {
  defaultSettings,
  type Snapshot,
  type Lead,
  type DiscoverySettings,
  type Job,
} from "../shared/types";
import { LeadTable, Priority } from "./components/LeadTable";
import { LeadDetail } from "./components/LeadDetail";
import { ProspectPipeline } from "./components/ProspectPipeline";
import { DiscoveryWorkbench } from "./components/DiscoveryWorkbench";
import { OperationsStatus } from "./components/OperationsStatus";
import { DiscoveryForm } from "./components/DiscoveryForm";
import { DiscoveryControls } from "./components/DiscoveryControls";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { LocalBusinesses } from "./components/LocalBusinesses";
// Only the sign-in page shows it, so its animation kit loads with it
const SignInDemo = lazy(() => import("./components/SignInDemo"));
const empty: Snapshot = {
  leads: [],
  jobs: [],
  settings: [],
  candidates: 0,
  verified: 0,
  active: 0,
  failed: 0,
  reports: 0,
  organization: { id: "", name: "Your workspace" },
};
const navigation = [
  { label: "Overview", path: "/", icon: LayoutDashboard },
  { label: "Store discovery", path: "/discovery", icon: Compass },
  { label: "Leads", path: "/leads", icon: Store },
  { label: "Local businesses", path: "/local", icon: HardHat },
  { label: "Website audits", path: "/audits", icon: Activity },
  { label: "Website improvements", path: "/modernization", icon: Wrench },
  { label: "CRO opportunities", path: "/cro", icon: MousePointer2 },
  { label: "Reports", path: "/reports", icon: FileText },
  { label: "Automation jobs", path: "/jobs", icon: Workflow },
  { label: "Outreach review", path: "/outreach", icon: ShieldCheck },
];
// Lets the leads list load, with this workspace's saved filters, alongside the first snapshot.
const workspaceKey = (user: string) => `scout-last-workspace:${user}`;
function rememberedWorkspace(user?: string) {
  try {
    return (user && localStorage.getItem(workspaceKey(user))) || "";
  } catch {
    return "";
  }
}
function rememberWorkspace(user: string, id: string) {
  try {
    localStorage.setItem(workspaceKey(user), id);
  } catch {
    /* Without it the list just waits for the first snapshot. */
  }
}
function loadDemo() {
  try {
    const saved = localStorage.getItem("scout-demo-leads");
    return {
      ...demoSnapshot,
      leads: saved ? JSON.parse(saved) : demoSnapshot.leads,
      settings: localStorage.getItem("scout-demo-settings")
        ? [JSON.parse(localStorage.getItem("scout-demo-settings")!)]
        : demoSnapshot.settings,
    };
  } catch {
    return demoSnapshot;
  }
}
export default function App() {
  const [demo, setDemo] = useState(
    () =>
      import.meta.env.VITE_ENABLE_DEMO !== "false" &&
      (localStorage.getItem("scout-mode") === "demo" || !supabase),
  );
  const [demoData, setDemoData] = useState<Snapshot>(loadDemo),
    [liveData, setLiveData] = useState<Snapshot>(empty),
    [session, setSession] = useState<Session | null>(null),
    [sessionReady, setSessionReady] = useState(!supabase),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [noWorkspace, setNoWorkspace] = useState(false),
    [workspaceName, setWorkspaceName] = useState(""),
    [integrations, setIntegrations] = useState<Record<string, boolean>>({}),
    [selectedLead, setSelectedLead] = useState<Lead | null>(null),
    [reviewQueue, setReviewQueue] = useState<{
      ids: string[];
      start: string;
    } | null>(null),
    [toast, setToast] = useState(""),
    [showDiscovery, setShowDiscovery] = useState(false),
    [showGuide, setShowGuide] = useState(false),
    [showSearch, setShowSearch] = useState(false),
    [showNotifications, setShowNotifications] = useState(false),
    [alertFeed, setAlertFeed] = useState<AlertFeed | null>(null),
    [search, setSearch] = useState(""),
    [commandLeads, setCommandLeads] = useState<Lead[]>([]),
    [commandLoading, setCommandLoading] = useState(false),
    [commandError, setCommandError] = useState(""),
    [mobileNav, setMobileNav] = useState(false),
    [period, setPeriod] = useState(28),
    [jobAction, setJobAction] = useState<string | null>(null),
    [campaignId, setCampaignId] = useState(""),
    [newCampaign, setNewCampaign] = useState<DiscoverySettings | undefined>(),
    [leadRevision, setLeadRevision] = useState(0);
  function watchRun(job: Job) {
    navigate(`/jobs/${job.id}`);
  }
  const location = useLocation(),
    navigate = useNavigate();
  const data = demo ? demoData : liveData;
  const leadsWorkspace =
    data.organization.id || (demo ? "" : rememberedWorkspace(session?.user.id));
  const activeSettings =
    campaignId === "new"
      ? newCampaign
      : (data.settings.find((s) => s.id === campaignId) ?? data.settings[0]);
  const routePath = location.pathname.startsWith("/jobs/")
    ? "/jobs"
    : location.pathname;
  const page =
    navigation.find((n) => n.path === routePath)?.label ??
    (location.pathname === "/settings" ? "Settings" : "Overview");
  const refreshBusy = useRef(false);
  const activeUser = useRef<string | null>(null);
  function notify(message: string) {
    setToast(message);
  }
  async function refresh() {
    if (demo || !session || refreshBusy.current) return;
    refreshBusy.current = true;
    const requestedUser = session.user.id;
    setLoading(true);
    try {
      const result = await api<Snapshot>("/snapshot");
      if (activeUser.current !== requestedUser) return;
      setLiveData(result);
      rememberWorkspace(requestedUser, result.organization.id);
      setNoWorkspace(false);
      setLoadError("");
    } catch (e) {
      if (activeUser.current !== requestedUser) return;
      if ((e as Error & { code?: string }).code === "NO_WORKSPACE")
        setNoWorkspace(true);
      else
        setLoadError(
          e instanceof Error ? e.message : "Unable to load workspace",
        );
    } finally {
      refreshBusy.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!supabase) return;
    const applySession = (s: Session | null) => {
      if (activeUser.current !== (s?.user.id ?? null)) {
        activeUser.current = s?.user.id ?? null;
        setLiveData(empty);
        setCommandLeads([]);
        setSelectedLead(null);
        setNoWorkspace(false);
        setLoadError("");
      }
      setSession(s);
    };
    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setSessionReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
      setSessionReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setAlertFeed(demo ? demoAlerts : null);
    if (demo || !session) return;
    let current = true;
    const load = () =>
      void api<AlertFeed>("/alerts")
        .then((feed) => current && setAlertFeed(feed))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [demo, session?.user.id]);
  useEffect(() => {
    void fetch("/api/status")
      .then((r) => r.json())
      .then((r) => setIntegrations(r.integrations ?? {}))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void refresh();
    // A hidden tab catches up when it's shown again instead of polling unseen.
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [demo, session?.access_token]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!showSearch) return;
    let active = true;
    setCommandLoading(true);
    setCommandError("");
    const timer = setTimeout(() => {
      if (demo) {
        setCommandLeads(
          data.leads
            .filter((l) =>
              `${l.name} ${l.domain}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .slice(0, 5),
        );
        setCommandLoading(false);
        return;
      }
      void api<{ leads: Lead[] }>(
        `/leads?size=5&q=${encodeURIComponent(search)}`,
      )
        .then((result) => {
          if (active) setCommandLeads(result.leads);
        })
        .catch((e) => {
          if (active) {
            setCommandLeads([]);
            setCommandError(e.message);
          }
        })
        .finally(() => {
          if (active) setCommandLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [showSearch, search, demo, session?.user.id]);
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);
  useEffect(() => {
    if (selectedLead) {
      const updated = data.leads.find((l) => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  }, [data.leads]);
  function switchMode(value: boolean) {
    setDemo(value);
    localStorage.setItem("scout-mode", value ? "demo" : "live");
    setLoadError("");
    setSelectedLead(null);
  }
  function updateDemo(leads: Lead[]) {
    setDemoData((d) => ({ ...d, leads }));
    localStorage.setItem("scout-demo-leads", JSON.stringify(leads));
  }
  async function updateLead(lead: Lead, patch: Partial<Lead>) {
    if (demo)
      updateDemo(
        data.leads.map((l) =>
          l.id === lead.id
            ? { ...l, ...patch, name: patch.display_name ?? l.name }
            : l,
        ),
      );
    else {
      const { display_name, preferred_email, industry, ...leadPatch } = patch;
      if (Object.keys(leadPatch).length)
        await api(`/leads/${lead.id}`, leadPatch, "PATCH");
      if (
        display_name !== undefined ||
        preferred_email !== undefined ||
        industry !== undefined
      )
        await api(
          `/leads/${lead.id}/profile`,
          {
            ...(display_name !== undefined ? { display_name } : {}),
            ...(preferred_email !== undefined ? { preferred_email } : {}),
            ...(industry !== undefined ? { industry } : {}),
          },
          "PATCH",
        );
      await refresh();
      setLeadRevision((v) => v + 1);
      setSelectedLead(await api<Lead>(`/leads/${lead.id}`));
    }
    notify(demo ? "Sample prospect updated locally." : "Prospect updated.");
  }
  /** The strongest leads come first; the queue stays fixed while decisions land. */
  function openReview(lead: Lead, list: Lead[] = [lead]) {
    setSelectedLead(null);
    setReviewQueue({
      ids: [...list]
        .sort(
          (a, b) =>
            leadScoreFor(b).researchScore - leadScoreFor(a).researchScore,
        )
        .map((l) => l.id),
      start: lead.id,
    });
  }
  async function review(
    lead: Lead,
    status: "approved" | "rejected",
    rationale: string,
  ) {
    if (demo)
      updateDemo(
        data.leads.map((l) =>
          l.id === lead.id
            ? {
                ...l,
                permission: status,
                priority: status === "approved" ? 80 : 0,
              }
            : l,
        ),
      );
    else {
      await api(`/leads/${lead.id}/permission`, { status, rationale });
      await refresh();
    }
    notify(
      `${demo ? "Sample " : ""}eligibility review saved. No outreach was sent.`,
    );
  }
  async function suppress(lead: Lead, reason: string) {
    if (demo)
      updateDemo(
        data.leads.map((l) =>
          l.id === lead.id
            ? { ...l, suppressed: true, stage: "suppressed", priority: 0 }
            : l,
        ),
      );
    else {
      await api(`/leads/${lead.id}/suppress`, { reason });
      await refresh();
    }
    notify(
      "Domain suppressed. Future audits and eligibility approval are blocked.",
    );
  }
  async function report(lead: Lead) {
    try {
      if (demo) {
        const response = await fetch("/api/demo/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: lead.name, domain: lead.domain }),
        });
        if (!response.ok)
          throw new Error(
            "Demo PDF requires the local API server. Start npm run dev.",
          );
        downloadBlob(await response.blob(), "scout-synthetic-demo.pdf");
        notify("Downloaded a clearly labeled synthetic report example.");
      } else if (lead.report_id) {
        const { url } = await api<{ url: string }>(
          `/reports/${lead.report_id}/download`,
        );
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noreferrer";
        a.click();
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Report unavailable");
    }
  }
  async function retryResearch(job: Job) {
    if (jobAction) return;
    if (demo) return notify("Connect a live workspace to resume a job.");
    if (job.error_code === "search_limit") {
      setCampaignId(String(job.payload.query_id ?? ""));
      setShowDiscovery(true);
      return;
    }
    setJobAction(`retry:${job.id}`);
    try {
      await api(`/jobs/${job.id}/retry`, {}, "POST");
      await refresh();
      watchRun(job);
      notify("Job requeued. Follow its progress here.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setJobAction(null);
    }
  }
  async function audit(lead: Lead) {
    if (demo) {
      notify(
        "Connect a live workspace and configure PageSpeed to run a real audit.",
      );
      return;
    }
    try {
      const result = await api<{ already_queued: boolean }>(
        `/leads/${lead.id}/audit`,
        {},
      );
      notify(
        result.already_queued
          ? "An audit for this store is already queued."
          : "Re-audit queued. Track it in Automation jobs.",
      );
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function saveSettings(config: DiscoverySettings) {
    if (demo) {
      const saved = { ...config, id: "demo-query" };
      setDemoData((d) => ({ ...d, settings: [saved] }));
      localStorage.setItem("scout-demo-settings", JSON.stringify(saved));
      notify(
        "Preview configuration saved locally. Live automation remains disconnected.",
      );
    } else {
      const saved = await api<{ id: string }>("/settings", config);
      setCampaignId(saved.id);
      await refresh();
      notify("Discovery configuration saved.");
    }
  }
  async function runDiscovery() {
    if (demo) {
      notify(
        "Demo mode does not run discovery. Connect Supabase and a discovery provider in Settings.",
      );
      return;
    }
    if (!activeSettings?.id) {
      navigate("/discovery");
      notify("Save a discovery configuration first.");
      return;
    }
    try {
      const r = await api<{ already_queued: boolean }>("/discovery", {
        query_id: activeSettings!.id,
      });
      notify(
        r.already_queued
          ? "This discovery run is already queued."
          : "Discovery queued. The background worker will process it.",
      );
      setShowDiscovery(false);
      await refresh();
      navigate("/jobs");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function stopResearch(job?: Job) {
    if (jobAction) return;
    if (demo) {
      notify(
        "Preview only. Switch to your live workspace to stop real discovery or cancel a job.",
      );
      return;
    }
    setJobAction(job?.id ?? "discovery");
    try {
      const result = await api<{ cancelled: boolean | number }>(
        job ? `/jobs/${job.id}/cancel` : "/discovery/stop",
        {},
      );
      await refresh();
      notify(
        job
          ? result.cancelled
            ? "Job cancelled. A provider request already in progress may still finish."
            : "This job has already finished or been cancelled."
          : "Discovery stopped and all discovery schedules turned off. Existing audits can be cancelled below.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Unable to stop research");
    } finally {
      setJobAction(null);
    }
  }
  async function bulkJobs(jobs: Job[], action: "cancel" | "retry") {
    if (jobAction) return;
    if (demo) return notify("Connect a live workspace to change real jobs.");
    setJobAction("bulk");
    let done = 0;
    for (const job of jobs)
      try {
        await api(`/jobs/${job.id}/${action}`, {}, "POST");
        done++;
      } catch {
        // Reported as a count below; one failure shouldn't stop the others.
      }
    await refresh();
    setJobAction(null);
    const verb = action === "cancel" ? "Cancelled" : "Resumed";
    notify(
      done === jobs.length
        ? `${verb} ${done} ${done === 1 ? "job" : "jobs"}.`
        : `${verb} ${done} of ${jobs.length} jobs. The rest couldn't be changed.`,
    );
  }
  const pending = data.leads.filter(
      (l) => l.permission === "unknown" && !l.suppressed,
    ),
    priority = data.leads.filter((l) => l.priority >= 70),
    running = data.jobs.filter(
      (j) => j.status === "running" || j.status === "queued",
    );
  if (!sessionReady)
    return (
      <div className="app-loader">
        <Compass size={32} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!demo && !session)
    return (
      <Auth
        onDemo={() => switchMode(true)}
        demoEnabled={import.meta.env.VITE_ENABLE_DEMO !== "false"}
      />
    );
  if (noWorkspace && !demo)
    return (
      <div className="auth-shell">
        <form
          className="auth-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/workspace", { name: workspaceName });
              await refresh();
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          <div className="logo">
            <span>
              <Compass size={25} />
            </span>
            scout<span className="logo-dot">.</span>
          </div>
          <h1>Your research starts here.</h1>
          <p>Create your agency workspace to configure discovery.</p>
          <label className="field-label">
            Workspace name
            <input
              required
              minLength={1}
              maxLength={100}
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Your agency"
            />
          </label>
          <Button type="submit">
            Create workspace <ArrowRight size={16} />
          </Button>
          {toast && <p className="error-message">{toast}</p>}
        </form>
      </div>
    );
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="mobile-backdrop"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <NavLink to="/" className="logo">
          <span className="logo-mark">
            <Compass size={25} strokeWidth={2} />
          </span>
          scout<span className="logo-dot">.</span>
          <span className="product-tag">INTELLIGENCE</span>
        </NavLink>
        <button
          className="workspace-picker"
          onClick={() => navigate("/settings")}
        >
          <span className="workspace-avatar">
            {data.organization.name.slice(0, 1)}
          </span>
          <span>
            {data.organization.name}
            <small>Agency workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map((n, i) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""} ${i === 4 ? "nav-separator" : ""}`
              }
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.path === "/leads" && <b>{data.leads.length}</b>}
              {n.path === "/outreach" && pending.length > 0 && (
                <b className="amber-count">{pending.length}</b>
              )}
              {n.path === "/jobs" && running.length > 0 && (
                <span className="nav-running" />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="automation-widget">
            <div>
              <span
                className={`status-dot ${demo ? "teal" : running.length ? "green" : "gray"}`}
              />
              <strong>
                {demo
                  ? "Explore the workspace"
                  : running.length
                    ? "Research in progress"
                    : "Research workspace"}
              </strong>
              <Workflow size={16} />
            </div>
            <p>
              {demo
                ? "A little data. A lot of possibility."
                : "Your evidence. Your next opportunity."}
            </p>
            <button
              onClick={() => (demo ? switchMode(false) : navigate("/jobs"))}
            >
              {demo ? "Connect live workspace" : "View automation jobs"}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <NavLink className="nav-item" to="/settings">
            <Settings size={18} />
            Settings
          </NavLink>
          <button className="nav-item" onClick={() => setShowGuide(true)}>
            <LifeBuoy size={18} />
            Help & getting started
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <span className="profile-avatar">
              {demo ? "AC" : session?.user.email?.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>
                {demo ? "Alex Chen" : session?.user.email?.split("@")[0]}
              </strong>
              <small>{demo ? "Demo workspace" : "Agency researcher"}</small>
            </div>
            <button
              className="icon-button"
              aria-label={demo ? "Connect workspace" : "Sign out"}
              onClick={() => {
                if (demo) switchMode(false);
                else void supabase?.auth.signOut();
              }}
            >
              {demo ? <MoreHorizontal size={18} /> : <LogOut size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <button
              aria-label="Search workspace"
              className="global-search"
              onClick={() => setShowSearch(true)}
            >
              <Search size={16} />
              <span>Search anything...</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setShowNotifications(true)}
            >
              <Bell size={18} />
              {(alertFeed ? alertFeed.alerts.length : pending.length) > 0 && (
                <i
                  className={`notification-dot${alertFeed?.alerts.some((a) => a.severity !== "info") ? " urgent" : ""}`}
                />
              )}
            </button>
            <button
              className="top-avatar"
              aria-label="Account settings"
              onClick={() => navigate("/settings")}
            >
              {demo ? "AC" : session?.user.email?.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <span className="status-dot teal" />
              <strong>Demo workspace</strong>
              <span className="demo-banner-extra">
                Explore with fictional sample data. No live stores have been
                audited.
              </span>
            </span>
            <button onClick={() => switchMode(false)}>
              Connect your workspace <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main
          className={
            location.pathname === "/leads" ? "leads-workspace" : undefined
          }
        >
          <div className="page-heading">
            <div>
              <div className="heading-context">
                {location.pathname === "/"
                  ? "Your prospecting workspace"
                  : location.pathname === "/discovery"
                    ? "Find your next opportunity"
                    : location.pathname === "/leads"
                      ? "From research to relationships"
                      : location.pathname === "/local"
                        ? "Beyond online stores"
                        : "Shopify lead intelligence"}
              </div>
              <h1>
                {location.pathname === "/"
                  ? "A clearer view. Better opportunities."
                  : page === "Modernization"
                    ? "Website improvements"
                    : page}
              </h1>
              <p>
                {(
                  {
                    "/": "Discover promising stores, understand their challenges, and make your next move.",
                    "/discovery":
                      "Turn your ideal customer profile into a continuous pipeline of qualified research.",
                    "/leads":
                      "Compare stores, review the evidence, and choose your next step.",
                    "/audits":
                      "Measured findings from public storefronts. Every observation has a source.",
                    "/modernization":
                      "Active businesses with supported opportunities to improve their storefront.",
                    "/cro":
                      "Review shopping experience observations and ideas that need verification.",
                    "/reports":
                      "Evidence-backed audit reports, ready for a thoughtful conversation.",
                    "/jobs":
                      "Scout finds Shopify stores, audits them, and adds qualified ones to Leads.",
                    "/local":
                      "Businesses with a Google listing but no website of their own, such as a builder with only a Facebook page.",
                    "/outreach":
                      "Review contact eligibility and country-specific evidence before any outreach.",
                    "/settings":
                      "Configure your research workflow, integrations, and automation.",
                  } as Record<string, string>
                )[routePath] ?? "Explore your research workspace."}
              </p>
            </div>
            <div className="page-actions">
              {location.pathname === "/" && (
                <label className="period-select">
                  <CalendarDays size={16} />
                  <select
                    aria-label="Chart date range"
                    value={period}
                    onChange={(e) => setPeriod(Number(e.target.value))}
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={28}>Last 28 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
              )}
              <Button onClick={() => setShowDiscovery(true)}>
                <Plus size={16} />
                New discovery
              </Button>
            </div>
          </div>
          {loadError && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{loadError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </div>
          )}
          {loading && data.leads.length === 0 && (
            <div className="loading-bar">
              <LoaderCircle size={16} className="spin" />
              Loading live research…
            </div>
          )}
          {location.pathname === "/" && (
            <>
              <div className="metrics-strip">
                {[
                  {
                    label: "Discovered stores",
                    value: data.candidates,
                    icon: Globe2,
                    detail: demo
                      ? "Across 4 target countries"
                      : `${data.verified} Shopify verified`,
                    line: [12, 19, 15, 27, 23, 35, 29, 45, 43, 56],
                  },
                  {
                    label: "Audited websites",
                    value: demo ? 186 : data.leads.length,
                    icon: Activity,
                    detail: `${data.reports} reports generated`,
                    line: [10, 15, 13, 21, 27, 24, 33, 30, 46, 49],
                  },
                  {
                    label: "Approved priority prospects",
                    value: priority.length,
                    icon: Target,
                    detail: "Priority A · score of 70+",
                    line: [4, 8, 6, 16, 13, 23, 19, 28, 36, 42],
                  },
                  {
                    label: "Website improvements",
                    value: data.leads.filter(hasFrontendOpportunity).length,
                    icon: Wrench,
                    detail: "Supported by audit findings",
                    line: [8, 15, 11, 19, 26, 21, 32, 29, 43, 46],
                  },
                ].map((m, i) => (
                  <div className="metric" key={m.label}>
                    <div className="metric-label">
                      {m.label}
                      <m.icon size={16} />
                    </div>
                    <div className="metric-value">
                      {number(m.value)}
                      {demo && (
                        <svg
                          className={`sparkline sparkline-${i}`}
                          width="85"
                          height="38"
                          viewBox="0 0 90 50"
                          aria-label="Synthetic trend"
                        >
                          <path
                            d={`M ${m.line.map((v, k) => `${k * 10},${50 - v}`).join(" L ")}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                    <p>
                      <span className="metric-detail-dot" />
                      {m.detail}
                    </p>
                  </div>
                ))}
              </div>
              <div className="overview-middle">
                <section className="panel pipeline-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Discovery pipeline</h2>
                      <p>
                        {demo
                          ? "A growing pipeline of relevant Shopify stores."
                          : "Audited prospects by audit date."}
                      </p>
                    </div>
                    <div className="chart-legend">
                      <span>
                        <i /> {demo ? "Discovered" : "Audited"}
                      </span>
                      <span>
                        <i />
                        Qualified prospects
                      </span>
                    </div>
                  </div>
                  <PipelineChart
                    demo={demo}
                    period={period}
                    leads={data.leads}
                  />
                  <div className="pipeline-summary">
                    <div>
                      <span className="summary-symbol">
                        <Globe2 size={14} />
                      </span>
                      <strong>{number(data.verified)}</strong>
                      <span>Shopify verified</span>
                    </div>
                    <div>
                      <span className="summary-symbol">
                        <CheckCircle2 size={14} />
                      </span>
                      <strong>{number(data.active)}</strong>
                      <span>Active stores</span>
                    </div>
                    <button onClick={() => navigate("/discovery")}>
                      Explore discovery <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="panel focus-panel">
                  <div className="focus-heading">
                    <span className="focus-icon">
                      <Target size={20} />
                    </span>
                    <span>YOUR NEXT MOVE</span>
                    <ArrowUpRight size={16} />
                  </div>
                  <h2>
                    Good prospects.
                    <br />
                    Real opportunities.
                  </h2>
                  <p>
                    You have{" "}
                    <strong>
                      {priority.length} approved priority prospects
                    </strong>{" "}
                    with evidence worth a closer look.
                  </p>
                  <div className="focus-stack">
                    {priority.slice(0, 3).map((l, i) => (
                      <button key={l.id} onClick={() => setSelectedLead(l)}>
                        <span className={`brand-avatar ${l.color ?? "sage"}`}>
                          {l.name[0]}
                        </span>
                        <span>
                          <strong>{l.name}</strong>
                          <small>{l.industry}</small>
                        </span>
                        <b>
                          {l.priority}
                          <ArrowUpRight size={14} />
                        </b>
                      </button>
                    ))}
                    {!priority.length && (
                      <div className="focus-empty">
                        <ShieldCheck size={22} />
                        <p>
                          Review verified evidence and contact eligibility to
                          qualify your first prospect.
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    className="focus-cta"
                    onClick={() => navigate("/leads")}
                  >
                    Review prospects <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <LeadTable
                leads={data.leads}
                onOpen={setSelectedLead}
                onReport={(l) => void report(l)}
                compact
                title="Your next opportunities"
                description="Prioritized prospects with a reason to reach out."
              />
              <div className="overview-bottom">
                <div>
                  <span className="status-dot teal" />
                  <strong>
                    {demo
                      ? "Sample automation activity"
                      : running.length
                        ? `${running.length} jobs in the pipeline`
                        : "Ready for your next discovery"}
                  </strong>
                  <span>
                    {demo
                      ? "US · Home & furniture"
                      : (activeSettings?.name ??
                        "Configure your discovery criteria to get started")}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("/jobs")}
                >
                  View activity <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
          {location.pathname === "/leads" && (
            <ProspectPipeline
              key={`${demo}-${leadsWorkspace}`}
              leads={data.leads}
              onOpen={setSelectedLead}
              onReport={(l) => void report(l)}
              live={!demo}
              ready={!!leadsWorkspace || !!loadError}
              workspaceId={leadsWorkspace}
              queries={data.settings}
              // Only a finished audit adds or changes a lead.
              revision={
                !demo && liveData === empty
                  ? null
                  : `${leadRevision}-${data.jobs
                      .filter(
                        (j) => j.type === "audit" && j.status === "completed",
                      )
                      .map((j) => j.id)
                      .join(",")}`
              }
            />
          )}
          {(location.pathname === "/discovery" ||
            location.pathname === "/settings") && (
            <>
              <DiscoveryControls
                scheduled={data.settings.some((s) => s.enabled)}
                busy={jobAction !== null}
                stopping={jobAction === "discovery"}
                onStop={() => void stopResearch()}
              />
              {location.pathname === "/settings" && (
                <div className="connection-banner">
                  <span className="section-icon">
                    <LockKeyhole size={20} />
                  </span>
                  <div>
                    <strong>
                      {demo
                        ? "You’re exploring a demo workspace"
                        : "Your live agency workspace"}
                    </strong>
                    <p>
                      {demo
                        ? "Connect Supabase authentication, then configure server-side provider credentials to start real research."
                        : `Signed in as ${session?.user.email}. Secrets are managed through server environment variables.`}
                    </p>
                  </div>
                  {demo ? (
                    <Button variant="outline" onClick={() => switchMode(false)}>
                      Connect workspace <ArrowUpRight size={14} />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => void supabase?.auth.signOut()}
                    >
                      Sign out <LogOut size={14} />
                    </Button>
                  )}
                </div>
              )}
              <OperationsStatus key={data.organization.id} live={!demo} />
              <DiscoveryWorkbench
                live={!demo}
                campaigns={data.settings}
                selected={
                  campaignId === "new" ? "new" : (activeSettings?.id ?? "")
                }
                onSelect={setCampaignId}
                onNew={() => {
                  setNewCampaign({
                    ...(activeSettings ?? defaultSettings),
                    id: undefined,
                    name: "New focused campaign",
                    countries: [activeSettings?.countries[0] ?? "AU"],
                    industries: [
                      activeSettings?.industries[0] ?? "Beauty & skincare",
                    ],
                    provider: activeSettings?.provider ?? "tavily",
                    enabled: false,
                  });
                  setCampaignId("new");
                }}
              />
              <DiscoveryForm
                key={`${demo}-${campaignId === "new" ? "new" : (activeSettings?.id ?? "new")}`}
                initial={activeSettings}
                demo={demo}
                integrations={integrations}
                onSave={saveSettings}
                onRun={() => void runDiscovery()}
                settingsPage={location.pathname === "/settings"}
              />
            </>
          )}
          {location.pathname === "/audits" && (
            <>
              <div className="summary-row">
                <div>
                  <Activity size={18} />
                  <span>
                    <strong>{data.leads.length}</strong> completed storefront
                    audits
                  </span>
                </div>
                <div>
                  <AlertCircle size={18} />
                  <span>
                    <strong>{data.failed}</strong> failed audit runs
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/jobs")}
                >
                  View audit jobs <ArrowUpRight size={14} />
                </Button>
              </div>
              <LeadTable
                leads={data.leads}
                onOpen={setSelectedLead}
                onReport={(l) => void report(l)}
                title="Audited storefronts"
                description="Open a prospect to inspect exact URLs, observations, diagnostics, and audit history."
              />
            </>
          )}
          {location.pathname === "/modernization" && (
            <>
              <div className="scope-note">
                <Wrench size={20} />
                <div>
                  <strong>Website improvements need evidence.</strong>
                  <p>
                    Older design alone is not a defect. These opportunities are
                    supported by recorded frontend, image or accessibility
                    findings.
                  </p>
                </div>
              </div>
              <LeadTable
                leads={data.leads.filter(hasFrontendOpportunity)}
                onOpen={setSelectedLead}
                onReport={(l) => void report(l)}
                title="Storefronts worth a closer look"
                description="Stores with supported frontend, image or accessibility observations."
              />
            </>
          )}
          {location.pathname === "/cro" && (
            <>
              <div className="scope-note">
                <MousePointer2 size={20} />
                <div>
                  <strong>A better experience starts with observation.</strong>
                  <p>
                    CRO assessments are research heuristics, never measured
                    conversion rates. Private shopping analytics remain unknown.
                  </p>
                </div>
              </div>
              <LeadTable
                leads={data.leads.filter(
                  (l) =>
                    l.findings.some((f) => f.category === "CRO") ||
                    (l.cro ?? 0) >= 60,
                )}
                onOpen={setSelectedLead}
                onReport={(l) => void report(l)}
                title="Shopping experience opportunities"
                description="Review verified defects separately from optional optimization ideas."
              />
            </>
          )}
          {location.pathname === "/reports" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Audit report library{" "}
                    <span className="count-badge">
                      {data.leads.filter((l) => l.report_id).length}
                    </span>
                  </h2>
                  <p>
                    Personalized findings, clear evidence, and a prioritized
                    action plan.
                  </p>
                </div>
                <span className="badge">
                  <ShieldCheck size={14} />
                  Private storage
                </span>
              </div>
              <div className="report-list">
                {data.leads
                  .filter((l) => l.report_id)
                  .map((l) => (
                    <div className="report-row" key={l.id}>
                      <span className="report-icon">
                        <FileText size={22} />
                      </span>
                      <div>
                        <button onClick={() => setSelectedLead(l)}>
                          {l.name}
                          <ArrowUpRight size={14} />
                        </button>
                        <p>
                          {l.domain} · {formatDate(l.audited_at)} ·{" "}
                          {demo ? "Synthetic example" : "Evidence-backed audit"}
                        </p>
                      </div>
                      <span className="badge green">Ready</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void report(l)}
                      >
                        <Download size={14} />
                        PDF
                      </Button>
                    </div>
                  ))}
                {!data.leads.some((l) => l.report_id) && (
                  <Empty
                    icon={FileText}
                    title="Your first report starts with discovery"
                    text="Qualified audits generate a PDF with the available evidence and findings."
                    action={() => navigate("/discovery")}
                    actionLabel="Configure discovery"
                  />
                )}
              </div>
            </section>
          )}
          {routePath === "/jobs" && (
            <AutomationPage
              key={data.organization.id}
              jobs={data.jobs}
              loaded={demo || liveData !== empty}
              leads={data.leads}
              scheduled={data.settings.some((s) => s.enabled)}
              demo={demo}
              jobId={location.pathname.split("/")[2] ?? null}
              search={location.search}
              busy={jobAction !== null}
              jobAction={jobAction}
              loading={loading}
              navigate={navigate}
              onRefresh={() =>
                demo
                  ? notify(
                      "Sample jobs are static. Connect a live workspace to run real ones.",
                    )
                  : void refresh()
              }
              onCancel={(j) => void stopResearch(j)}
              onRetry={(j) => void retryResearch(j)}
              onBulk={(jobs, action) => void bulkJobs(jobs, action)}
              onStopDiscovery={() => void stopResearch()}
              onNewDiscovery={() => setShowDiscovery(true)}
              onOpenLead={setSelectedLead}
            />
          )}
          {location.pathname === "/local" && (
            <LocalBusinesses demo={demo} notify={notify} />
          )}
          {location.pathname === "/outreach" && (
            <>
              <div className="scope-note">
                <ShieldCheck size={22} />
                <div>
                  <strong>Every conversation starts with a review.</strong>
                  <p>
                    Check country evidence, contact relevance, permission, and
                    suppression. No messages are sent from this application.
                  </p>
                </div>
              </div>
              <LeadTable
                leads={pending}
                onOpen={(lead) => openReview(lead, pending)}
                onReport={(l) => void report(l)}
                rowAction="Review"
                title="Awaiting human review"
                description="Review a store to approve it for outreach or mark it not eligible."
              />
            </>
          )}
          <footer className="page-footer">
            <span>
              <Compass size={14} />
              Scout · Shopify Lead Intelligence
            </span>
            <span>
              <ShieldCheck size={14} />
              Evidence first. Always.
            </span>
          </footer>
        </main>
      </div>
      <LeadDetail
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onReport={(l) => void report(l)}
        onAudit={(l) => void audit(l)}
        onUpdate={updateLead}
        onOpenReview={(lead) => openReview(lead)}
        demo={demo}
      />
      {reviewQueue && (
        <OutreachReview
          key={reviewQueue.ids.join()}
          leads={data.leads}
          queue={reviewQueue.ids}
          startId={reviewQueue.start}
          demo={demo}
          onReview={review}
          onSuppress={suppress}
          onOpenFull={(lead) => {
            setReviewQueue(null);
            setSelectedLead(lead);
          }}
          onClose={() => setReviewQueue(null)}
        />
      )}
      <Dialog
        open={showDiscovery}
        onOpenChange={setShowDiscovery}
        title="Start a new discovery"
        description="Find relevant stores using your saved research configuration."
      >
        <div className="discovery-dialog">
          <div className="discovery-illustration">
            <Compass size={36} />
          </div>
          <h3>A fresh set of possibilities.</h3>
          <p>
            {activeSettings?.name ??
              "Create your first research configuration to begin."}
          </p>
          <div className="discovery-config-summary">
            <div>
              <span>Target countries</span>
              <strong>
                {activeSettings?.countries.join(" · ") ?? "Not configured"}
              </strong>
            </div>
            <div>
              <span>Provider</span>
              <strong>
                {activeSettings?.provider === "brave"
                  ? "Brave Search"
                  : activeSettings?.provider === "tavily"
                    ? "Tavily Search"
                    : "Store Leads"}
              </strong>
            </div>
            <div>
              <span>Batch size</span>
              <strong>{activeSettings?.batch_size ?? 10} stores</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>
                {demo ? "Demo · no live requests" : "Live server-side research"}
              </strong>
            </div>
          </div>
          {demo && (
            <div className="inline-note">
              Connect a live workspace and provider credentials to run real
              discovery. Sample stores will never be presented as real research.
            </div>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={() => {
                setShowDiscovery(false);
                navigate("/discovery");
              }}
            >
              Edit criteria
            </Button>
            <Button onClick={() => void runDiscovery()}>
              <Play size={14} />
              Run discovery
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={showGuide}
        onOpenChange={setShowGuide}
        title="Your guide to Scout"
        description="From discovery to evidence-backed opportunities."
      >
        <div className="guide-content">
          {[
            [
              "Connect your workspace",
              "Configure Supabase Auth, apply the database migration, and set server credentials.",
            ],
            [
              "Define your ideal prospect",
              "Choose countries, industries, a discovery provider, budgets, and thresholds.",
            ],
            [
              "Start the background worker",
              "Run npm run worker on an always-on host to process jobs and schedules.",
            ],
            [
              "Inspect evidence, then review",
              "Read findings and reports. Record country-specific contact eligibility before outreach.",
            ],
          ].map(([title, text], i) => (
            <div className="guide-step" key={title}>
              <span>{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <div className="inline-note">
            <ShieldCheck size={18} />
            Full setup and deployment instructions are included in the
            repository README.
          </div>
        </div>
      </Dialog>
      <Dialog
        open={showSearch}
        onOpenChange={setShowSearch}
        title="Search your workspace"
        description="Find a prospect or jump to a workspace view."
      >
        <div className="command-search">
          <label className="search-input">
            <Search size={18} />
            <input
              autoFocus
              placeholder="Brand, domain, or page..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="command-results">
            {commandLoading && (
              <p role="status" className="muted">
                Searching full lead history…
              </p>
            )}
            {commandError && (
              <p role="alert" className="form-error">
                {commandError}
              </p>
            )}
            {commandLeads.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setShowSearch(false);
                  setSelectedLead(l);
                }}
              >
                <Store size={16} />
                <span>
                  <strong>{l.name}</strong>
                  <small>{l.domain}</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            {navigation
              .filter((n) =>
                n.label.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(0, 4)
              .map((n) => (
                <button
                  key={n.path}
                  onClick={() => {
                    setShowSearch(false);
                    navigate(n.path);
                  }}
                >
                  <n.icon size={16} />
                  <strong>{n.label}</strong>
                  <ArrowRight size={14} />
                </button>
              ))}
          </div>
        </div>
      </Dialog>
      <Dialog
        open={showNotifications}
        onOpenChange={setShowNotifications}
        title="Workspace updates"
        description={
          demo
            ? "Synthetic examples from the demo workspace."
            : "Updates from the current research pipeline."
        }
      >
        <div className="notification-list">
          {alertFeed?.alerts.map((alert) => {
            const Icon =
              alert.severity !== "info"
                ? AlertCircle
                : alert.key === "new_leads"
                  ? Store
                  : ShieldCheck;
            return (
              <button
                key={alert.key}
                className={alert.severity}
                onClick={() => {
                  setShowNotifications(false);
                  navigate(alert.path);
                }}
              >
                <Icon size={20} />
                <span>
                  <strong>{alert.title}</strong>
                  <small>{alert.detail}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
          {!alertFeed && (
            <button
              onClick={() => {
                setShowNotifications(false);
                navigate("/outreach");
              }}
            >
              <ShieldCheck size={20} />
              <span>
                <strong>
                  {pending.length} prospects need eligibility review
                </strong>
                <small>
                  Check permission and country evidence before outreach.
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          )}
          <button
            onClick={() => {
              setShowNotifications(false);
              navigate("/jobs");
            }}
          >
            <Workflow size={20} />
            <span>
              <strong>
                {running.length} queued or running{" "}
                {running.length === 1 ? "job" : "jobs"}
              </strong>
              <small>Review progress and any worker errors.</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
        {alertFeed && (
          <section className="digest" aria-label="Last 24 hours">
            <h3>Last 24 hours</h3>
            <dl>
              <div>
                <dt>New leads</dt>
                <dd>{alertFeed.digest.new_leads}</dd>
              </div>
              <div>
                <dt>Audits</dt>
                <dd>{alertFeed.digest.audits_completed}</dd>
              </div>
              <div>
                <dt>Failed</dt>
                <dd>{alertFeed.digest.failed_jobs}</dd>
              </div>
              <div>
                <dt>To review</dt>
                <dd>{alertFeed.digest.awaiting_review}</dd>
              </div>
            </dl>
            {alertFeed.digest.top_leads.length > 0 && (
              <ol>
                {alertFeed.digest.top_leads.map((lead) => (
                  <li key={lead.id}>
                    <span>{lead.name}</span>
                    {lead.score !== null && <b>{lead.score}</b>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </Dialog>
      {routePath !== "/jobs" && (
        <AutomationOrb
          jobs={data.jobs.filter((job) => job.status === "running")}
          onOpen={watchRun}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function PipelineChart({
  demo,
  period,
  leads,
}: {
  demo: boolean;
  period: number;
  leads: Lead[];
}) {
  const points = Array.from({ length: period === 7 ? 7 : 14 }, (_, i) => {
    const date = new Date();
    date.setDate(
      date.getDate() -
        period +
        Math.round((i * period) / (period === 7 ? 6 : 13)),
    );
    date.setHours(0, 0, 0, 0);
    return {
      date: date.toLocaleDateString("en", { month: "short", day: "numeric" }),
      discovered: demo
        ? [22, 35, 30, 48, 42, 65, 53, 78, 68, 94, 86, 115, 104, 136][i]
        : leads.filter(
            (l) =>
              l.audited_at &&
              new Date(l.audited_at).toDateString() === date.toDateString(),
          ).length,
      qualified: demo
        ? [7, 12, 10, 18, 15, 25, 20, 32, 26, 39, 34, 47, 43, 58][i]
        : leads.filter(
            (l) =>
              l.priority >= 70 &&
              l.audited_at &&
              new Date(l.audited_at).toDateString() === date.toDateString(),
          ).length,
    };
  });
  return (
    <div
      className="pipeline-chart"
      role="img"
      aria-label={`${demo ? "Synthetic sample discovery" : "Audited prospect"} chart over ${period} days`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 12, right: 8, left: -21, bottom: 0 }}
        >
          <defs>
            <linearGradient id="area-discovered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={30}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            dy={9}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickCount={5}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
              boxShadow: "none",
            }}
          />
          <Area
            type="monotone"
            name={demo ? "Discovered" : "Audited"}
            dataKey="discovered"
            stroke="var(--primary)"
            strokeWidth={2.4}
            fill="url(#area-discovered)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            name="Qualified"
            dataKey="qualified"
            stroke="var(--chart-secondary)"
            strokeWidth={2}
            strokeDasharray="4 4"
            fill="transparent"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
  actionLabel,
}: {
  icon: typeof FileText;
  title: string;
  text: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      <Button variant="outline" size="sm" onClick={action}>
        {actionLabel}
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}
function Auth({
  onDemo,
  demoEnabled,
}: {
  onDemo: () => void;
  demoEnabled: boolean;
}) {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const result = signup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage("Check your email to confirm your account, then sign in.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-intro">
        <div className="logo">
          <span className="logo-mark">
            <Compass size={28} />
          </span>
          scout<span className="logo-dot">.</span>
        </div>
        <div>
          <span className="auth-intro-label">SHOPIFY LEAD INTELLIGENCE</span>
          <h1>
            Find the stores.
            <br />
            See the opportunity.
            <br />
            Make it count.
          </h1>
          <p>
            Your next great client starts with better research. Build a pipeline
            backed by evidence, not assumptions.
          </p>
          <span className="auth-footer">
            <ShieldCheck size={16} />
            Research on autopilot. Outreach in your hands.
          </span>
        </div>
        <div className="auth-showcase" aria-hidden="true">
          <Suspense fallback={null}>
            <SignInDemo />
          </Suspense>
        </div>
      </div>
      <div className="auth-form-side">
        <form className="auth-card" onSubmit={submit}>
          <h2>
            {supabase
              ? signup
                ? "Create your account"
                : "Welcome to your workspace"
              : "Connect your live workspace"}
          </h2>
          <p>
            {supabase
              ? "Evidence-backed opportunities are waiting."
              : "Set up Supabase to enable authentication and real research."}
          </p>
          {supabase ? (
            <>
              <label className="field-label">
                Email address
                <div className="input-with-icon">
                  <Mail size={16} />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </label>
              <label className="field-label">
                Password
                <div className="input-with-icon">
                  <LockKeyhole size={16} />
                  <input
                    required
                    minLength={8}
                    type="password"
                    autoComplete={signup ? "new-password" : "current-password"}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </label>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              {message && <p className="inline-note">{message}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : null}
                {signup ? "Create account" : "Sign in"}
                <ArrowRight size={16} />
              </Button>
              <button
                type="button"
                className="text-button auth-toggle"
                onClick={() => {
                  setSignup(!signup);
                  setError("");
                }}
              >
                {signup
                  ? "Already have an account? Sign in"
                  : "New to Scout? Create an account"}
              </button>
            </>
          ) : (
            <div className="setup-checklist">
              <div>
                <span>1</span>
                <p>
                  Create a Supabase project and apply{" "}
                  <code>supabase/migrations/001_initial.sql</code>.
                </p>
              </div>
              <div>
                <span>2</span>
                <p>
                  Copy <code>.env.example</code> to <code>.env</code>. Add
                  public project values and server secrets.
                </p>
              </div>
              <div>
                <span>3</span>
                <p>
                  Restart <code>npm run dev</code>, then run{" "}
                  <code>npm run worker</code> to process research jobs.
                </p>
              </div>
              <a
                className="button button-outline"
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                Open Supabase <ExternalLink size={14} />
              </a>
            </div>
          )}
          {demoEnabled && (
            <div className="auth-demo">
              <span>Want to look around first?</span>
              <Button type="button" variant="outline" onClick={onDemo}>
                Explore the demo <ArrowUpRight size={14} />
              </Button>
              <small>Fictional sample data. No live audits.</small>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
