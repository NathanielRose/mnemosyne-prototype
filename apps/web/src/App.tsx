import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Phone,
  Clock,
  CalendarCheck,
  AlertTriangle,
  CheckCircle2,
  ListTodo,
  Sparkles,
  Search,
  Download,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Star,
  Bell,
  X,
  Trash2,
  MoreHorizontal,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

/**
 * ARXONTIKO Hotel & Restaurant — Call AI Dashboard (POC UI)
 * - Timeline: last 6 calls
 * - To Do: calls requiring action + booking workflow
 * - Insights: weekly volume, avg call length, outcomes
 *
 * Uses API data + local state.
 */

const formatSecs = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
const PAGE_SIZE = 6;

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (d >= startOfToday) return `Today ${time}`;
  if (d >= startOfYesterday) return `Yesterday ${time}`;

  const startOfPastWeek = new Date(startOfToday);
  startOfPastWeek.setDate(startOfPastWeek.getDate() - 6);
  if (d >= startOfPastWeek) {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${time}`;
  }

  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const hasNonEmptyText = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0;

const getSummaryText = (value?: string | null) =>
  hasNonEmptyText(value) ? value!.trim() : "No summary yet";

// Tiny “test cases” (runs in dev; harmless in prod)
console.assert(formatSecs(0) === "0:00", "formatSecs(0) should be 0:00");
console.assert(formatSecs(61) === "1:01", "formatSecs(61) should be 1:01");
console.assert(formatSecs(600) === "10:00", "formatSecs(600) should be 10:00");

type CallOutcome = "Booked" | "Needs follow-up" | "No answer" | "Inquiry";

type ReservationDraft = {
  guestName: string;
  phone: string;
  email: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  adults: number;
  children: number;
  roomType: "Single" | "Double" | "Triple" | "Suite";
  rateType: "Standard" | "Non-refundable" | "Half-board";
  notes: string;
  status: "Draft" | "Pending confirmation" | "Confirmed";
};

type CallRecord = {
  id: string;
  when: string; // e.g., "Today 09:12"
  iso: string; // e.g., "2026-01-28T09:12:00"
  from: string;
  callerName?: string;
  to?: string;
  durationSec: number;
  language: "Greek" | "English";
  detectedLanguage?: string;
  transcriptPreviewOriginal?: string;
  transcriptPreviewEn?: string;
  transcriptOriginal?: string;
  transcriptEnglish?: string;
  outcome: CallOutcome;
  priority: "Low" | "Medium" | "High";
  summary: string;
  transcriptPreview: string;
  notes?: string;
  extracted?: Partial<ReservationDraft>;
  requiresAction: boolean;

  // Optional extras (POC)
  tag?: string; // e.g., "Wedding"
  rateEUR?: number; // show for booked calls
  topLevelTags?: TopLevelTag[];
};

type ApiCall = {
  id: string;
  externalId: string;
  startedAt: string;
  fromNumber: string;
  callerName?: string | null;
  callerNameSource?: string | null;
  toNumber?: string | null;
  durationSec: number;
  language: CallRecord["language"];
  detectedLanguage?: string | null;
  transcriptPreviewOriginal?: string | null;
  transcriptPreviewEn?: string | null;
  transcriptOriginal?: string | null;
  transcriptEnglish?: string | null;
  outcome: CallOutcome;
  priority: CallRecord["priority"];
  summary: string;
  transcriptPreview: string | null;
  notes?: string | null;
  status?: string | null;
  requiresAction: boolean;
  tag: string | null;
  rateEur: number | string | null;
  topLevelTags?: string[];
};

type ConfirmedTask = {
  id: string;
  callId: string;
  externalId: string;
  when: string;
  fromNumber: string;
  callerName?: string | null;
  title: string;
  description: string;
  assigneeSuggestion?: string | null;
  dueAt?: string | null;
  priority: string;
  status: string;
  confidence?: number | null;
  evidenceQuotes: string[];
};

type SuggestedTask = {
  id: string;
  title: string;
  description: string;
  assigneeSuggestion?: string | null;
  dueAt?: string | null;
  priority: string;
  status: string;
  evidenceQuotes: string[];
  confidence?: number | null;
};

type SuggestedTag = {
  id: string;
  tag: string;
  confidence?: number | null;
};

type SuggestedParticipant = {
  id: string;
  name?: string | null;
  role: string;
  confidence?: number | null;
  evidenceQuotes: string[];
};

type CallAnalysis = {
  callId: string;
  externalId: string;
  status?: string | null;
  reason?: string | null;
  model?: string | null;
  ranAt?: string | null;
  thresholdSec?: number | null;
  summaryShort?: string | null;
  summaryDetailed?: string | null;
  quality?: {
    transcriptReliability?: string | null;
    hallucinationRisk?: string | null;
    notes?: string | null;
  } | null;
  tasks: SuggestedTask[];
  // Confirmed top-level category chips (Reservations / Special Requests / Inquiries / Miscellaneous).
  topLevelTags: SuggestedTag[];
  // Top-level categories still pending user acceptance (below auto-apply threshold).
  topLevelTagsSuggested: SuggestedTag[];
  // Free-form detail tags for the suggested panel.
  detailTagsSuggested: SuggestedTag[];
  participants: SuggestedParticipant[];
};

type AnalysisSelectionState = {
  summaryShort: boolean;
  summaryDetailed: boolean;
  taskIds: Record<string, boolean>;
  tagIds: Record<string, boolean>;
  participantIds: Record<string, boolean>;
};

const EMPTY_ANALYSIS_SELECTION: AnalysisSelectionState = {
  summaryShort: false,
  summaryDetailed: false,
  taskIds: {},
  tagIds: {},
  participantIds: {},
};

const outcomeBadge = (outcome: CallOutcome) => {
  const map: Record<
    CallOutcome,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    Booked: { label: "Booked", variant: "default" },
    "Needs follow-up": { label: "Needs follow-up", variant: "secondary" },
    "No answer": { label: "No answer", variant: "outline" },
    Inquiry: { label: "Inquiry", variant: "outline" },
  };

  const m = map[outcome];
  return <Badge variant={m.variant}>{m.label}</Badge>;
};

const TOP_LEVEL_TAGS = [
  "Reservations",
  "Special Requests",
  "Inquiries",
  "Miscellaneous",
] as const;
type TopLevelTag = (typeof TOP_LEVEL_TAGS)[number];

const topLevelTagClass: Record<TopLevelTag, string> = {
  Reservations: "rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-200",
  "Special Requests": "rounded-xl bg-sky-100 text-sky-900 border border-sky-200",
  Inquiries: "rounded-xl bg-purple-100 text-purple-900 border border-purple-200",
  Miscellaneous: "rounded-xl bg-slate-100 text-slate-700 border border-slate-200",
};

const isTopLevelTag = (value: unknown): value is TopLevelTag =>
  typeof value === "string" && (TOP_LEVEL_TAGS as readonly string[]).includes(value);

const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700",
  "bg-gradient-to-br from-violet-100 to-violet-200 text-violet-700",
  "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700",
  "bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700",
];

function avatarFor(call: { id: string; callerName?: string }) {
  const name = (call.callerName ?? "").trim();
  let label: string;
  if (!name) {
    label = "?";
  } else {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      label = (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    } else if (parts[0]) {
      label = parts[0].slice(0, 2).toUpperCase();
    } else {
      label = "?";
    }
  }
  const h = call.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const cls = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return { label, cls };
}

// Bolds date-range, currency, and room-type phrases in the feed summary.
// Keep the regex conservative — worth surfacing at a glance, not every noun.
const SUMMARY_HIGHLIGHT_RE =
  /(€\s?\d+(?:\s?[-–]\s?\d+)?(?:\s*\/\s*night)?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d+(?:\s*[-–]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?\d+)?|\b(?:Single|Double|Triple|Suite)\s+room\b)/gi;

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightSummary(text: string): string {
  return escapeHtml(text).replace(
    SUMMARY_HIGHLIGHT_RE,
    (m) => `<b class="font-semibold text-indigo-700">${m}</b>`
  );
}

const weekSeries = [
  { day: "Mon", calls: 5, avgSec: 210 },
  { day: "Tue", calls: 7, avgSec: 240 },
  { day: "Wed", calls: 9, avgSec: 198 },
  { day: "Thu", calls: 6, avgSec: 220 },
  { day: "Fri", calls: 8, avgSec: 260 },
  { day: "Sat", calls: 10, avgSec: 235 },
  { day: "Sun", calls: 4, avgSec: 190 },
];

const outcomes = [
  { name: "Booked", value: 12 },
  { name: "Needs follow-up", value: 8 },
  { name: "Inquiry", value: 15 },
  { name: "No answer", value: 6 },
];

type StatTone = "indigo" | "violet" | "amber" | "green";
type StatTrend = { tone: "up" | "warn" | "flat"; value?: string; label: string };

const STAT_TONE: Record<StatTone, { iconBg: string; iconFg: string; sparkStroke: string }> = {
  indigo: { iconBg: "bg-indigo-50", iconFg: "text-indigo-600", sparkStroke: "url(#spark-indigo)" },
  violet: { iconBg: "bg-violet-50", iconFg: "text-violet-600", sparkStroke: "#8B5CF6" },
  amber: { iconBg: "bg-amber-50", iconFg: "text-amber-700", sparkStroke: "#F59E0B" },
  green: { iconBg: "bg-emerald-50", iconFg: "text-emerald-700", sparkStroke: "#10B981" },
};

function Stat({
  label,
  value,
  unit,
  icon: Icon,
  tone = "indigo",
  trend,
  sparkPath,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: any;
  tone?: StatTone;
  trend?: StatTrend;
  sparkPath?: string;
}) {
  const toneCfg = STAT_TONE[tone];
  const trendClass =
    trend?.tone === "up"
      ? "text-emerald-600 font-medium"
      : trend?.tone === "warn"
      ? "text-amber-600 font-medium"
      : "text-muted-foreground";
  const trendGlyph = trend?.tone === "up" ? "↗" : trend?.tone === "warn" ? "●" : "—";
  return (
    <Card className="relative overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneCfg.iconBg} ${toneCfg.iconFg}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <div className="text-4xl font-semibold tracking-tight tabular-nums">{value}</div>
          {unit ? <div className="text-sm text-muted-foreground">{unit}</div> : null}
        </div>
        {trend ? (
          <div className="mt-2 text-xs font-mono flex items-center gap-1.5">
            {trend.value ? (
              <span className={trendClass}>
                {trendGlyph} {trend.value}
              </span>
            ) : (
              <span className={trendClass}>{trendGlyph}</span>
            )}
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        ) : null}
        {sparkPath ? (
          <svg
            className="absolute right-0 bottom-0 opacity-30 pointer-events-none"
            width="110"
            height="44"
            viewBox="0 0 110 44"
            fill="none"
          >
            <defs>
              <linearGradient id="spark-indigo" x1="0" x2="110">
                <stop stopColor="#6366F1" />
                <stop offset="1" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
            <path d={sparkPath} stroke={toneCfg.sparkStroke} strokeWidth={1.8} fill="none" />
          </svg>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CallRow({
  call,
  onSelect,
  isSelected,
}: {
  call: CallRecord;
  onSelect: (c: CallRecord) => void;
  isSelected?: boolean;
}) {
  const hasSummary = hasNonEmptyText(call.summary);
  const summaryText = getSummaryText(call.summary);
  const avatar = avatarFor(call);
  const lang = call.detectedLanguage ? call.detectedLanguage : call.language;
  const langCode = lang?.slice(0, 2).toUpperCase();

  return (
    <button
      className="w-full text-left"
      onClick={() => onSelect(call)}
      aria-label={`Open call ${call.id}`}
    >
      <div
        className={[
          "grid grid-cols-[44px_1fr_auto] gap-4 px-5 py-4 border-b border-zinc-100 transition",
          isSelected ? "row-selected" : "hover:bg-zinc-50/70",
        ].join(" ")}
      >
        <div
          className={[
            "h-[42px] w-[42px] rounded-full border border-zinc-200 grid place-items-center text-sm font-semibold",
            avatar.cls,
          ].join(" ")}
        >
          {avatar.label}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">{call.when}</span>
            <span className="h-[3px] w-[3px] rounded-full bg-zinc-400" />
            <span className="font-mono text-xs text-muted-foreground truncate">{call.from}</span>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2">
            {(call.topLevelTags ?? []).map((t) => (
              <span key={`${call.id}-top-${t}`} className={`${topLevelTagClass[t]} text-[11px] px-2.5 py-0.5`}>
                {t}
              </span>
            ))}
            {lang ? (
              <span className="inline-flex items-center rounded-full text-[11px] px-2.5 py-0.5 bg-zinc-100 text-zinc-600 border border-zinc-200">
                {langCode} · {lang}
              </span>
            ) : null}
            {call.requiresAction ? (
              <span className="inline-flex items-center gap-1 rounded-full text-[11px] px-2.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200">
                <span className="h-[5px] w-[5px] rounded-full bg-current" />
                Needs action
              </span>
            ) : null}
          </div>

          <div
            className={[
              "text-sm leading-5 line-clamp-2 max-w-xl",
              hasSummary ? "" : "text-muted-foreground italic",
            ].join(" ")}
            {...(hasSummary
              ? { dangerouslySetInnerHTML: { __html: highlightSummary(summaryText) } }
              : { children: summaryText })}
          />
        </div>

        <div className="flex flex-col items-end gap-1.5 min-w-[92px]">
          {call.outcome === "Booked" && typeof call.rateEUR === "number" ? (
            <div className="text-lg font-semibold tracking-tight text-indigo-700 tabular-nums">
              €{call.rateEUR}
              <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/ night</span>
            </div>
          ) : null}
          <PriorityPill priority={call.priority} />
          <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> {formatSecs(call.durationSec)}
          </div>
          <div className="font-mono text-[10px] text-zinc-400" title={call.id}>
            SID · {call.id.slice(-6)}
          </div>
        </div>
      </div>
    </button>
  );
}

function DetailField({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {action}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function PriorityPill({ priority }: { priority: CallRecord["priority"] }) {
  const map: Record<CallRecord["priority"], string> = {
    High: "bg-red-50 text-red-700 border-red-200",
    Medium: "bg-amber-50 text-amber-800 border-amber-200",
    Low: "bg-zinc-50 text-zinc-600 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 ${map[priority]}`}
    >
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      {priority}
    </span>
  );
}


function mapApiCall(row: ApiCall): CallRecord {
  const rate = row.rateEur !== null ? Number(row.rateEur) : undefined;
  const iso = row.startedAt;
  return {
    id: row.externalId,
    when: formatWhen(iso),
    iso,
    from: row.fromNumber,
    callerName: row.callerName ?? undefined,
    to: row.toNumber ?? undefined,
    durationSec: row.durationSec,
    language: row.language,
    detectedLanguage: row.detectedLanguage ?? undefined,
    transcriptPreviewOriginal: row.transcriptPreviewOriginal ?? undefined,
    transcriptPreviewEn: row.transcriptPreviewEn ?? undefined,
    transcriptOriginal: row.transcriptOriginal ?? undefined,
    transcriptEnglish: row.transcriptEnglish ?? undefined,
    outcome: row.outcome,
    priority: row.priority,
    summary: row.summary,
    transcriptPreview: row.transcriptPreview ?? "(no transcript)",
    notes: row.notes ?? undefined,
    requiresAction: row.requiresAction,
    tag: row.tag ?? undefined,
    rateEUR: Number.isFinite(rate) ? rate : undefined,
    topLevelTags: Array.isArray(row.topLevelTags)
      ? row.topLevelTags.filter(isTopLevelTag)
      : undefined,
  };
}

export default function App() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [deletedCalls, setDeletedCalls] = useState<CallRecord[]>([]);
  const [selected, setSelected] = useState<CallRecord | null>(null);
  const [query, setQuery] = useState<string>("");
  const [transcriptExpanded, setTranscriptExpanded] = useState<boolean>(false);
  const [transcriptVariant, setTranscriptVariant] = useState<"original" | "en">("en");
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [notesSaving, setNotesSaving] = useState<boolean>(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesEditing, setNotesEditing] = useState<boolean>(false);
  const [notesSlideIn, setNotesSlideIn] = useState<boolean>(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<CallAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSelection, setAnalysisSelection] = useState<AnalysisSelectionState>(
    EMPTY_ANALYSIS_SELECTION
  );
  const [acceptingSuggestions, setAcceptingSuggestions] = useState<boolean>(false);
  const [acceptSuggestionsError, setAcceptSuggestionsError] = useState<string | null>(null);
  const [dismissingSuggestions, setDismissingSuggestions] = useState<boolean>(false);
  const [dismissSuggestionsError, setDismissSuggestionsError] = useState<string | null>(null);
  const [callerDraft, setCallerDraft] = useState<string>("");
  const [callerEditing, setCallerEditing] = useState<boolean>(false);
  const [callerSaving, setCallerSaving] = useState<boolean>(false);
  const [callerError, setCallerError] = useState<string | null>(null);
  const [confirmedTasks, setConfirmedTasks] = useState<ConfirmedTask[]>([]);
  const [confirmedTasksLoading, setConfirmedTasksLoading] = useState<boolean>(false);
  const [confirmedTasksError, setConfirmedTasksError] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});
  const [hasMoreCalls, setHasMoreCalls] = useState<boolean>(false);
  const [loadingMoreCalls, setLoadingMoreCalls] = useState<boolean>(false);
  const [deletingCall, setDeletingCall] = useState<boolean>(false);
  const [deleteCallError, setDeleteCallError] = useState<string | null>(null);
  const [detailsMenuOpen, setDetailsMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadCalls = async () => {
      try {
        const [res, deletedRes] = await Promise.all([
          fetch(`${apiBaseUrl}/calls?limit=${PAGE_SIZE + 1}&offset=0`, {
            signal: controller.signal,
          }),
          fetch(`${apiBaseUrl}/calls/deleted?limit=200&offset=0`, {
            signal: controller.signal,
          }),
        ]);
        if (!res.ok) throw new Error(`Failed to load calls: ${res.status}`);
        if (!deletedRes.ok) throw new Error(`Failed to load deleted calls: ${deletedRes.status}`);
        const data = (await res.json()) as ApiCall[];
        const deletedData = (await deletedRes.json()) as ApiCall[];
        if (!Array.isArray(data)) throw new Error("Invalid calls payload");
        if (!Array.isArray(deletedData)) throw new Error("Invalid deleted calls payload");

        const hasMore = data.length > PAGE_SIZE;
        const mapped = data.slice(0, PAGE_SIZE).map(mapApiCall);
        const deletedMapped = deletedData.map(mapApiCall);

        if (!cancelled) {
          setCalls(mapped);
          setDeletedCalls(deletedMapped);
          setSelected(mapped[0] ?? null);
          setHasMoreCalls(hasMore);
        }
      } catch {
        if (!cancelled) {
          setCalls([]);
          setDeletedCalls([]);
          setSelected(null);
          setHasMoreCalls(false);
        }
      }
    };

    loadCalls();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setTranscriptExpanded(false);
    setTranscriptVariant(selected?.transcriptPreviewEn ? "en" : "original");
    setNotesDraft(selected?.notes ?? "");
    setNotesError(null);
    setNotesEditing(!(selected?.notes ?? "").trim().length);
    setNotesSlideIn(false);
    setAnalysisSelection(EMPTY_ANALYSIS_SELECTION);
    setAcceptSuggestionsError(null);
    setDismissSuggestionsError(null);
    setCallerDraft(selected?.callerName ?? "");
    setCallerEditing(false);
    setCallerError(null);
    setDeleteCallError(null);
    setDetailsMenuOpen(false);
    setExpandedEvidence({});
  }, [selected?.id]);

  const loadConfirmedTasks = async () => {
    setConfirmedTasksLoading(true);
    setConfirmedTasksError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/tasks?state=confirmed`);
      if (!res.ok) throw new Error(`Failed to load tasks: ${res.status}`);
      const data = (await res.json()) as { ok?: boolean; tasks?: ConfirmedTask[] };
      setConfirmedTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch {
      setConfirmedTasks([]);
      setConfirmedTasksError("Could not load confirmed tasks.");
    } finally {
      setConfirmedTasksLoading(false);
    }
  };

  useEffect(() => {
    loadConfirmedTasks();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selected?.id) {
        if (!cancelled) {
          setSelectedAnalysis(null);
          setAnalysisError(null);
        }
        return;
      }
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const res = await fetch(
          `${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/analysis`
        );
        if (res.status === 404) {
          if (!cancelled) setSelectedAnalysis(null);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load analysis: ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; analysis?: CallAnalysis };
        if (!cancelled) {
          setSelectedAnalysis(data?.analysis ?? null);
        }
      } catch {
        if (!cancelled) {
          setAnalysisError("Could not load AI suggestions yet.");
        }
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  const filtered = useMemo(() => {
    if (!query.trim()) return calls;
    const q = query.toLowerCase();
    return calls.filter((c) =>
      [c.id, c.from, c.summary, c.transcriptPreview, c.language, c.outcome]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [calls, query]);

  const last6 = useMemo(() => {
    return [...calls].sort((a, b) => (a.iso < b.iso ? 1 : -1));
  }, [calls]);

  const needsAction = useMemo(() => {
    if (!query.trim()) return confirmedTasks;
    const q = query.toLowerCase();
    return confirmedTasks.filter((t) =>
      [t.title, t.description, t.externalId, t.fromNumber, t.callerName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [confirmedTasks, query]);

  const avgLen = useMemo(() => {
    const xs = calls.map((c) => c.durationSec);
    const avg = xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    return Math.round(avg);
  }, [calls]);

  const callsThisWeek = useMemo(() => {
    // POC: just use mock series total
    return weekSeries.reduce((a, b) => a + b.calls, 0);
  }, []);

  const notifCount = useMemo(() => {
    return calls.filter((c) => c.requiresAction).length;
  }, [calls]);
  const formatConfidence = (v?: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "n/a";
  const toggleEvidence = (key: string) =>
    setExpandedEvidence((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAnalysisSelection = (
    kind: "summaryShort" | "summaryDetailed" | "taskIds" | "tagIds" | "participantIds",
    id?: string
  ) => {
    setAnalysisSelection((prev) => {
      if (kind === "summaryShort" || kind === "summaryDetailed") {
        return {
          ...prev,
          [kind]: !prev[kind],
        };
      }
      if (!id) return prev;
      return {
        ...prev,
        [kind]: {
          ...prev[kind],
          [id]: !prev[kind][id],
        },
      };
    });
  };
  const selectedSuggestionCount =
    (analysisSelection.summaryShort ? 1 : 0) +
    (analysisSelection.summaryDetailed ? 1 : 0) +
    Object.values(analysisSelection.taskIds).filter(Boolean).length +
    Object.values(analysisSelection.tagIds).filter(Boolean).length +
    Object.values(analysisSelection.participantIds).filter(Boolean).length;
  const analysisForDisplay = selectedAnalysis;
  const hasPendingAnalysisSuggestions = !!selectedAnalysis && (
    (selectedAnalysis.summaryShort ?? "").trim().length > 0 ||
    (selectedAnalysis.summaryDetailed ?? "").trim().length > 0 ||
    selectedAnalysis.tasks.length > 0 ||
    selectedAnalysis.topLevelTagsSuggested.length > 0 ||
    selectedAnalysis.detailTagsSuggested.length > 0 ||
    selectedAnalysis.participants.length > 0
  );
  const persistedNotes = (selected?.notes ?? "").trim();
  const draftNotes = notesDraft.trim();
  const hasNoteChanges = !!selected && draftNotes !== persistedNotes;
  const showSaveNotesButton =
    !!selected &&
    notesEditing &&
    hasNoteChanges &&
    (draftNotes.length > 0 || persistedNotes.length > 0);

  const handleSaveNotes = async () => {
    if (!selected || notesSaving) return;
    setNotesSaving(true);
    setNotesError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/notes`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notesDraft }),
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to save notes: ${res.status}`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        call?: { externalId?: string; notes?: string | null };
      };
      const savedNotes = data.call?.notes ?? null;
      setCalls((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                notes: savedNotes ?? undefined,
              }
            : c
        )
      );
      setSelected((prev) =>
        prev && prev.id === selected.id
          ? {
              ...prev,
              notes: savedNotes ?? undefined,
            }
          : prev
      );
      setNotesDraft(savedNotes ?? "");
      setNotesEditing(false);
      setNotesSlideIn(true);
      setTimeout(() => setNotesSlideIn(false), 350);
    } catch {
      setNotesError("Could not save notes. Please try again.");
    } finally {
      setNotesSaving(false);
    }
  };

  const handleEditNotes = () => {
    if (!selected) return;
    setNotesDraft(selected.notes ?? "");
    setNotesError(null);
    setNotesEditing(true);
  };

  const handleCancelNotesEdit = () => {
    if (!selected) return;
    setNotesDraft(selected.notes ?? "");
    setNotesError(null);
    setNotesEditing(false);
  };

  const handleSaveCaller = async () => {
    if (!selected || callerSaving) return;
    setCallerSaving(true);
    setCallerError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/caller`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerName: callerDraft }),
      });
      if (!res.ok) throw new Error(`Failed to save caller: ${res.status}`);
      const data = (await res.json()) as {
        ok?: boolean;
        call?: { callerName?: string | null };
      };
      const nextCaller = data.call?.callerName ?? null;
      setCalls((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, callerName: nextCaller ?? undefined } : c))
      );
      setSelected((prev) =>
        prev && prev.id === selected.id ? { ...prev, callerName: nextCaller ?? undefined } : prev
      );
      setCallerDraft(nextCaller ?? "");
      setCallerEditing(false);
      await loadConfirmedTasks();
    } catch {
      setCallerError("Could not save caller name.");
    } finally {
      setCallerSaving(false);
    }
  };

  const handleDismissAllSuggestions = async () => {
    if (!selected || !selectedAnalysis || dismissingSuggestions) return;
    setDismissingSuggestions(true);
    setDismissSuggestionsError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/analysis/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }
      );
      if (!res.ok) throw new Error(`Failed to dismiss suggestions: ${res.status}`);

      const analysisRes = await fetch(`${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/analysis`);
      if (analysisRes.ok) {
        const analysisData = (await analysisRes.json()) as { analysis?: CallAnalysis };
        setSelectedAnalysis(analysisData.analysis ?? null);
      } else if (analysisRes.status === 404) {
        setSelectedAnalysis(null);
      }
      setAnalysisSelection(EMPTY_ANALYSIS_SELECTION);
      await loadConfirmedTasks();
    } catch {
      setDismissSuggestionsError("Could not dismiss all suggestions. Please try again.");
    } finally {
      setDismissingSuggestions(false);
    }
  };

  const handleAcceptSelectedSuggestions = async () => {
    if (!selected || !selectedAnalysis || selectedSuggestionCount === 0 || acceptingSuggestions) return;
    setAcceptingSuggestions(true);
    setAcceptSuggestionsError(null);
    try {
      const payload = {
        summaryShort: analysisSelection.summaryShort,
        summaryDetailed: analysisSelection.summaryDetailed,
        taskIds: Object.entries(analysisSelection.taskIds)
          .filter(([, checked]) => checked)
          .map(([id]) => id),
        tagIds: Object.entries(analysisSelection.tagIds)
          .filter(([, checked]) => checked)
          .map(([id]) => id),
        participantIds: Object.entries(analysisSelection.participantIds)
          .filter(([, checked]) => checked)
          .map(([id]) => id),
      };

      const res = await fetch(
        `${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/analysis/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to accept suggestions: ${res.status}`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        call?: { summary?: string | null; tag?: string | null; callerName?: string | null };
      };

      setCalls((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                summary:
                  typeof data.call?.summary === "string"
                    ? data.call.summary
                    : c.summary,
                tag:
                  typeof data.call?.tag === "string"
                    ? data.call.tag
                    : data.call?.tag === null
                      ? undefined
                      : c.tag,
                callerName:
                  typeof data.call?.callerName === "string"
                    ? data.call.callerName
                    : data.call?.callerName === null
                      ? undefined
                      : c.callerName,
              }
            : c
        )
      );
      setSelected((prev) =>
        prev && prev.id === selected.id
          ? {
              ...prev,
              summary:
                typeof data.call?.summary === "string"
                  ? data.call.summary
                  : prev.summary,
              tag:
                typeof data.call?.tag === "string"
                  ? data.call.tag
                  : data.call?.tag === null
                    ? undefined
                    : prev.tag,
              callerName:
                typeof data.call?.callerName === "string"
                  ? data.call.callerName
                  : data.call?.callerName === null
                    ? undefined
                    : prev.callerName,
            }
          : prev
      );
      if (typeof data.call?.callerName === "string" || data.call?.callerName === null) {
        setCallerDraft(data.call?.callerName ?? "");
      }

      const analysisRes = await fetch(`${apiBaseUrl}/calls/${encodeURIComponent(selected.id)}/analysis`);
      if (analysisRes.ok) {
        const analysisData = (await analysisRes.json()) as { analysis?: CallAnalysis };
        setSelectedAnalysis(analysisData.analysis ?? null);
      } else if (analysisRes.status === 404) {
        setSelectedAnalysis(null);
      }
      setAnalysisSelection(EMPTY_ANALYSIS_SELECTION);
      await loadConfirmedTasks();
    } catch {
      setAcceptSuggestionsError("Could not accept selected suggestions. Please try again.");
    } finally {
      setAcceptingSuggestions(false);
    }
  };

  const handleDeleteSelectedCall = async () => {
    if (!selected || deletingCall) return;
    const confirmed = window.confirm(
      `Move call ${selected.id.slice(-6)} to Deleted calls? You can still view it in the Deleted tab.`
    );
    if (!confirmed) return;
    setDeletingCall(true);
    setDeleteCallError(null);
    const deleting = selected;
    try {
      const res = await fetch(`${apiBaseUrl}/calls/${encodeURIComponent(deleting.id)}/delete`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error(`Failed to delete call: ${res.status}`);

      setDeletedCalls((prev) => [deleting, ...prev.filter((c) => c.id !== deleting.id)]);
      setCalls((prev) => {
        const remaining = prev.filter((c) => c.id !== deleting.id);
        setSelected((curr) => (curr?.id === deleting.id ? (remaining[0] ?? null) : curr));
        return remaining;
      });
    } catch {
      setDeleteCallError("Could not delete call. Please try again.");
    } finally {
      setDeletingCall(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl border bg-background/60 backdrop-blur flex items-center justify-center shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold tracking-widest uppercase font-mono">
                    <span className="bg-gradient-to-r from-fuchsia-500 to-purple-500 bg-clip-text text-transparent font-semibold">
                      Μneemi AI
                    </span>
                  </div>
                  <Badge variant="outline" className="rounded-xl">
                    POC
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  ARXONTIKO Hotel & Restaurant • Call-to-booking dashboard
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full md:w-[520px]">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs font-mono tracking-wide">Ask</span>
                </div>
                <Input
                  className="h-11 pl-16 pr-24 rounded-full bg-background/70 backdrop-blur border shadow-sm"
                  placeholder="Ask about calls, dates, names, rooms…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {query.trim() ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setQuery("")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Badge variant="outline" className="rounded-full font-mono text-[11px]">
                      ⌘ K
                    </Badge>
                  )}
                  <Button size="sm" className="rounded-full bg-brand-gradient hover:opacity-90 text-white border-0">
                    <Search className="h-4 w-4 mr-2" /> Search
                  </Button>
                </div>
              </div>

              <button
                className="relative h-11 w-11 rounded-full border bg-background/70 backdrop-blur shadow-sm hover:shadow transition flex items-center justify-center"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="h-5 w-5" />
                {notifCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white text-[11px] font-semibold flex items-center justify-center">
                    {notifCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold">
                ARXONTIKO Hotel & Restaurant
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Review calls • confirm bookings • zero missed reservations
              </p>
            </div>
          </div>
        </div>

        {calls.length === 0 && (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl border bg-background flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <div className="text-sm font-medium">No calls captured yet</div>
                  <div className="text-xs text-muted-foreground">
                    When calls arrive, they will show up here automatically.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="Calls this week"
            value={`${callsThisWeek}`}
            unit="calls"
            icon={Phone}
            tone="indigo"
            trend={{ tone: "up", value: "+18%", label: "vs. last week" }}
            sparkPath="M0 30 L15 28 L30 32 L45 22 L60 25 L75 15 L90 18 L110 8"
          />
          <Stat
            label="Avg call length"
            value={`${formatSecs(avgLen)}`}
            unit="min"
            icon={Clock}
            tone="violet"
            trend={{ tone: "flat", label: "stable week-over-week" }}
            sparkPath="M0 22 L15 24 L30 20 L45 23 L60 21 L75 22 L90 20 L110 22"
          />
          <Stat
            label="Needs action"
            value={`${calls.filter((c) => c.requiresAction).length}`}
            unit="open"
            icon={ListTodo}
            tone="amber"
            trend={{ tone: "warn", label: "follow-up within 4 h" }}
          />
          <Stat
            label="Bookings (sample)"
            value={`${calls.filter((c) => c.outcome === "Booked").length}`}
            unit="sample"
            icon={CalendarCheck}
            tone="green"
            trend={{ tone: "up", value: "€540", label: "booked value" }}
          />
        </div>

        <Tabs defaultValue="timeline" className="w-full">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList className="rounded-2xl bg-white border border-zinc-200 p-1 shadow-sm">
              <TabsTrigger
                value="timeline"
                className="rounded-xl gap-2 data-[state=active]:bg-brand-gradient data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Timeline
                <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-zinc-100 text-zinc-500 data-[state=active]:bg-white/25 data-[state=active]:text-white">
                  {calls.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="todo"
                className="rounded-xl gap-2 data-[state=active]:bg-brand-gradient data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                To do
                <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-zinc-100 text-zinc-500">
                  {calls.filter((c) => c.requiresAction).length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="insights"
                className="rounded-xl data-[state=active]:bg-brand-gradient data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Insights
              </TabsTrigger>
              <TabsTrigger
                value="deleted"
                className="rounded-xl gap-2 data-[state=active]:bg-brand-gradient data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Deleted
                {deletedCalls.length > 0 ? (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-zinc-100 text-zinc-500">
                    {deletedCalls.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>

            {/* Filter pills — placeholder UI, not yet wired to query params. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-sm"
              >
                <CalendarCheck className="h-3.5 w-3.5" />
                Last 7 days
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-white border border-zinc-200 text-zinc-600 shadow-sm hover:border-zinc-300"
              >
                All languages
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm bg-white border border-zinc-200 text-zinc-600 shadow-sm hover:border-zinc-300"
              >
                All priorities
              </button>
            </div>
          </div>

          {/* Timeline */}
          <TabsContent value="timeline" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="rounded-2xl shadow-sm lg:col-span-2 overflow-hidden">
                <CardHeader className="pb-3 flex-row items-baseline justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg">
                      Recent calls <span className="text-muted-foreground font-normal">— {last6.length} of {calls.length}</span>
                    </CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground">Click a row for full transcript →</span>
                </CardHeader>
                <CardContent className="p-0 [&>button:last-child>div]:border-b-0">
                  {last6.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground">
                      No calls captured yet.
                    </div>
                  ) : (
                    <>
                      {last6.map((c) => (
                        <CallRow
                          key={c.id}
                          call={c}
                          onSelect={setSelected}
                          isSelected={selected?.id === c.id}
                        />
                      ))}

                      {hasMoreCalls && (
                        <div className="p-4">
                          <Button
                            className="w-full rounded-2xl"
                            variant="outline"
                            disabled={loadingMoreCalls}
                            onClick={async () => {
                              if (loadingMoreCalls) return;
                              setLoadingMoreCalls(true);
                              try {
                                const offset = calls.length;
                                const res = await fetch(
                                  `${apiBaseUrl}/calls?limit=${PAGE_SIZE + 1}&offset=${offset}`
                                );
                                if (!res.ok) throw new Error(`Failed to load more calls: ${res.status}`);
                                const data = (await res.json()) as ApiCall[];
                                if (!Array.isArray(data)) throw new Error("Invalid calls payload");

                                const hasMore = data.length > PAGE_SIZE;
                                const mapped = data.slice(0, PAGE_SIZE).map(mapApiCall);

                                setCalls((prev) => [...prev, ...mapped]);
                                setHasMoreCalls(hasMore);
                              } catch {
                                // keep existing list; just stop spinner
                              } finally {
                                setLoadingMoreCalls(false);
                              }
                            }}
                          >
                            {loadingMoreCalls ? "Loading…" : "Load more"}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Call details</CardTitle>
                  <CardDescription>Transcript + extracted fields (POC)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selected ? (
                    <div className="text-sm text-muted-foreground">Select a call.</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold">{selected.when}</div>
                          {(selected.topLevelTags ?? []).map((t) => (
                            <Badge key={`detail-top-${t}`} className={topLevelTagClass[t]}>
                              {t}
                            </Badge>
                          ))}
                        </div>
                        <div className="relative flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-xl"
                            onClick={() => setDetailsMenuOpen((v) => !v)}
                            aria-label="Call actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                          {detailsMenuOpen ? (
                            <div className="absolute right-0 top-9 z-20 min-w-[180px] rounded-xl border border-zinc-200 bg-white p-1 shadow-md">
                              <button
                                type="button"
                                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100"
                                onClick={() => {
                                  setCallerEditing(true);
                                  setDetailsMenuOpen(false);
                                }}
                              >
                                Edit call details
                              </button>
                              <button
                                type="button"
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                onClick={async () => {
                                  setDetailsMenuOpen(false);
                                  await handleDeleteSelectedCall();
                                }}
                                disabled={deletingCall}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {deletingCall ? "Deleting..." : "Delete call"}
                                </span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {deleteCallError ? (
                        <div className="text-xs text-red-600">{deleteCallError}</div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-1">
                        <DetailField label="From">
                          <span className="font-mono text-[13px]">{selected.from}</span>
                        </DetailField>
                        <DetailField
                          label="Caller"
                          action={
                            !callerEditing ? (
                              <button
                                type="button"
                                className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium"
                                onClick={() => setCallerEditing(true)}
                              >
                                Edit
                              </button>
                            ) : null
                          }
                        >
                          {callerEditing ? (
                            <div className="space-y-2">
                              <Input
                                value={callerDraft}
                                onChange={(e) => setCallerDraft(e.target.value)}
                                placeholder="Caller name"
                                className="h-8"
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="rounded-lg h-7 px-3 text-xs"
                                  disabled={callerSaving}
                                  onClick={handleSaveCaller}
                                >
                                  {callerSaving ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg h-7 px-3 text-xs"
                                  disabled={callerSaving}
                                  onClick={() => {
                                    setCallerDraft(selected.callerName ?? "");
                                    setCallerEditing(false);
                                    setCallerError(null);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                              {callerError ? (
                                <div className="text-xs text-red-600">{callerError}</div>
                              ) : null}
                            </div>
                          ) : (
                            <>
                              {selected.callerName?.trim() ? selected.callerName : "Unknown"}
                              {selected.callerNameSource === "ai" ? (
                                <span className="ml-1.5 text-[11px] text-muted-foreground">· AI-inferred</span>
                              ) : null}
                            </>
                          )}
                        </DetailField>
                        <DetailField label="Duration">
                          <span className="font-mono text-[13px]">{formatSecs(selected.durationSec)}</span>
                        </DetailField>
                        <DetailField label="Language">
                          {selected.detectedLanguage || selected.language}
                          {selected.transcriptEnglish ? (
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">· translated</span>
                          ) : null}
                        </DetailField>
                      </div>

                      <Separator />

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                            Summary
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-medium px-2 py-0.5 bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 text-indigo-700">
                            <Sparkles className="h-2.5 w-2.5" />
                            AI generated
                          </span>
                        </div>
                        <div
                          className={[
                            "text-[15px] leading-relaxed",
                            hasNonEmptyText(selected.summary) ? "" : "text-muted-foreground italic",
                          ].join(" ")}
                          {...(hasNonEmptyText(selected.summary)
                            ? { dangerouslySetInnerHTML: { __html: highlightSummary(getSummaryText(selected.summary)) } }
                            : { children: getSummaryText(selected.summary) })}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">Transcript preview</div>
                          <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-xl border bg-background/60 p-0.5">
                              <button
                                type="button"
                                className={[
                                  "px-2 py-1 text-xs rounded-lg transition",
                                  transcriptVariant === "original"
                                    ? "bg-brand-gradient text-white"
                                    : "text-muted-foreground hover:text-foreground",
                                ].join(" ")}
                                onClick={() => setTranscriptVariant("original")}
                                disabled={!selected.transcriptPreviewOriginal && !selected.transcriptPreview}
                                aria-label="Show original transcript"
                              >
                                Original
                              </button>
                              <button
                                type="button"
                                className={[
                                  "px-2 py-1 text-xs rounded-lg transition",
                                  transcriptVariant === "en"
                                    ? "bg-brand-gradient text-white"
                                    : "text-muted-foreground hover:text-foreground",
                                ].join(" ")}
                                onClick={() => setTranscriptVariant("en")}
                                disabled={!selected.transcriptPreviewEn}
                                aria-label="Show English transcript"
                              >
                                English
                              </button>
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl h-8 px-2"
                              onClick={() => setTranscriptExpanded((v) => !v)}
                            >
                              {transcriptExpanded ? (
                                <>
                                  <ChevronUp className="h-4 w-4 mr-1" /> Less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-4 w-4 mr-1" /> More
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        <div
                          className={[
                            "mt-1 text-sm text-muted-foreground whitespace-pre-wrap",
                            transcriptExpanded ? "" : "line-clamp-4",
                          ].join(" ")}
                        >
                          {transcriptVariant === "en"
                            ? selected.transcriptEnglish ??
                              selected.transcriptPreviewEn ??
                              selected.transcriptPreview
                            : selected.transcriptOriginal ??
                              selected.transcriptPreviewOriginal ??
                              selected.transcriptPreview}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">Notes</div>
                          <div className="flex items-center gap-2">
                            {notesEditing ? (
                              <>
                                {showSaveNotesButton && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="rounded-xl h-8 px-3"
                                    disabled={notesSaving}
                                    onClick={handleSaveNotes}
                                  >
                                    {notesSaving ? "Saving..." : "Save notes"}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-xl h-8 px-3"
                                  disabled={notesSaving}
                                  onClick={handleCancelNotesEdit}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl h-8 px-3"
                                onClick={handleEditNotes}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                        {notesEditing ? (
                          <Textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            placeholder="Add private notes about this call..."
                            className="mt-2 min-h-[96px]"
                          />
                        ) : (
                          <div
                            className={[
                              "mt-2 text-sm text-muted-foreground italic whitespace-pre-wrap",
                              "transform transition-all duration-300",
                              notesSlideIn ? "-translate-x-2 opacity-70" : "translate-x-0 opacity-100",
                            ].join(" ")}
                          >
                            {persistedNotes.length
                              ? persistedNotes
                              : "No notes yet. Click Edit to add one."}
                          </div>
                        )}
                        {notesError ? (
                          <div className="mt-1 text-xs text-red-600">{notesError}</div>
                        ) : null}
                      </div>

                      {analysisLoading || analysisError || hasPendingAnalysisSuggestions ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Star className="h-4 w-4 text-amber-500" />
                              AI Suggested
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-lg px-2 text-xs"
                                onClick={handleDismissAllSuggestions}
                                disabled={dismissingSuggestions || !selectedAnalysis}
                              >
                                {dismissingSuggestions ? "Dismissing..." : "Dismiss all"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 rounded-lg px-2 text-xs bg-brand-gradient hover:opacity-90 text-white border-0"
                                onClick={handleAcceptSelectedSuggestions}
                                disabled={
                                  selectedSuggestionCount === 0 || acceptingSuggestions || !selectedAnalysis
                                }
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                {acceptingSuggestions
                                  ? "Accepting..."
                                  : `Accept selected${selectedSuggestionCount ? ` (${selectedSuggestionCount})` : ""}`}
                              </Button>
                            </div>
                          </div>
                          {analysisLoading ? (
                            <div className="text-xs text-muted-foreground">Loading suggestions...</div>
                          ) : analysisError ? (
                            <div className="text-xs text-red-600">{analysisError}</div>
                          ) : analysisForDisplay ? (
                            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
                            <div className="text-xs text-muted-foreground">
                              Status: {analysisForDisplay.status ?? "unknown"}
                              {analysisForDisplay.reason
                                ? ` • Reason: ${analysisForDisplay.reason}`
                                : ""}
                              {analysisForDisplay.model
                                ? ` • Model: ${analysisForDisplay.model}`
                                : ""}
                            </div>

                            <div className="rounded-lg border border-zinc-200 bg-white/80 p-2">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Summary
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Short = concise paragraph for feed. Detailed = fuller paragraph for call details.
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3">
                                <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={analysisSelection.summaryShort}
                                    onChange={() => toggleAnalysisSelection("summaryShort")}
                                  />
                                  Select short
                                </label>
                                <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={analysisSelection.summaryDetailed}
                                    onChange={() => toggleAnalysisSelection("summaryDetailed")}
                                  />
                                  Select detailed
                                </label>
                              </div>
                              <div className="text-sm">{analysisForDisplay.summaryShort || "-"}</div>
                              <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                                {analysisForDisplay.summaryDetailed || "-"}
                              </div>
                            </div>

                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Tasks ({analysisForDisplay.tasks.length})
                              </div>
                              <div className="space-y-2 mt-1">
                                {analysisForDisplay.tasks.map((task) => {
                                  const evidenceKey = `task-${task.id}`;
                                  const open = !!expandedEvidence[evidenceKey];
                                  return (
                                    <div key={task.id} className="rounded-lg border border-zinc-200 bg-white/80 p-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-medium">{task.title}</div>
                                        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                          <input
                                            type="checkbox"
                                            checked={!!analysisSelection.taskIds[task.id]}
                                            onChange={() => toggleAnalysisSelection("taskIds", task.id)}
                                          />
                                          Select
                                        </label>
                                      </div>
                                      <div className="text-xs text-muted-foreground">{task.description}</div>
                                      <div className="text-xs text-muted-foreground mt-1">
                                        Priority: {task.priority} • Status: {task.status} • Confidence:{" "}
                                        {formatConfidence(task.confidence)}
                                      </div>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="mt-2 h-7 rounded-lg px-2 text-xs"
                                        onClick={() => toggleEvidence(evidenceKey)}
                                      >
                                        {open ? (
                                          <>
                                            <ChevronUp className="h-3 w-3 mr-1" /> Hide evidence
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="h-3 w-3 mr-1" /> Show evidence
                                          </>
                                        )}
                                      </Button>
                                      {open && (
                                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                          {task.evidenceQuotes.map((q, idx) => (
                                            <li key={`${task.id}-${idx}`} className="italic">
                                              "{q}"
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {analysisForDisplay.topLevelTagsSuggested.length > 0 ? (
                              <div>
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Category tags — needs review ({analysisForDisplay.topLevelTagsSuggested.length})
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {analysisForDisplay.topLevelTagsSuggested.map((tag) => (
                                    <button
                                      type="button"
                                      key={tag.id}
                                      onClick={() => toggleAnalysisSelection("tagIds", tag.id)}
                                      className={[
                                        "rounded-xl border px-2 py-1 text-xs",
                                        analysisSelection.tagIds[tag.id]
                                          ? "border-purple-300 bg-purple-50 text-purple-700"
                                          : "border-zinc-200 bg-white/80 text-muted-foreground",
                                      ].join(" ")}
                                    >
                                      {tag.tag} ({formatConfidence(tag.confidence)})
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Suggested tags ({analysisForDisplay.detailTagsSuggested.length})
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {analysisForDisplay.detailTagsSuggested.map((tag) => (
                                  <button
                                    type="button"
                                    key={tag.id}
                                    onClick={() => toggleAnalysisSelection("tagIds", tag.id)}
                                    className={[
                                      "rounded-xl border px-2 py-1 text-xs",
                                      analysisSelection.tagIds[tag.id]
                                        ? "border-purple-300 bg-purple-50 text-purple-700"
                                        : "border-zinc-200 bg-white/80 text-muted-foreground",
                                    ].join(" ")}
                                  >
                                    {tag.tag} ({formatConfidence(tag.confidence)})
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Participants ({analysisForDisplay.participants.length})
                              </div>
                              <div className="space-y-2 mt-1">
                                {analysisForDisplay.participants.map((p) => {
                                  const evidenceKey = `participant-${p.id}`;
                                  const open = !!expandedEvidence[evidenceKey];
                                  return (
                                    <div key={p.id} className="rounded-lg border border-zinc-200 bg-white/80 p-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm">
                                          {p.name ?? "Unknown"} — {p.role}
                                        </div>
                                        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                          <input
                                            type="checkbox"
                                            checked={!!analysisSelection.participantIds[p.id]}
                                            onChange={() =>
                                              toggleAnalysisSelection("participantIds", p.id)
                                            }
                                          />
                                          Select
                                        </label>
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Confidence: {formatConfidence(p.confidence)}
                                      </div>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="mt-2 h-7 rounded-lg px-2 text-xs"
                                        onClick={() => toggleEvidence(evidenceKey)}
                                      >
                                        {open ? (
                                          <>
                                            <ChevronUp className="h-3 w-3 mr-1" /> Hide evidence
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="h-3 w-3 mr-1" /> Show evidence
                                          </>
                                        )}
                                      </Button>
                                      {open && (
                                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                          {p.evidenceQuotes.map((q, idx) => (
                                            <li key={`${p.id}-${idx}`} className="italic">
                                              "{q}"
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                              {acceptSuggestionsError ? (
                                <div className="text-xs text-red-600">{acceptSuggestionsError}</div>
                              ) : null}
                              {dismissSuggestionsError ? (
                                <div className="text-xs text-red-600">{dismissSuggestionsError}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <Separator />

                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="rounded-xl">
                          {selected.detectedLanguage ? selected.detectedLanguage : selected.language}
                        </Badge>
                        <PriorityPill priority={selected.priority} />
                      </div>

                      {!selected.requiresAction && (
                        <div className="text-xs text-muted-foreground">
                          This call is marked clean (no action).
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Deleted */}
          <TabsContent value="deleted" className="mt-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Deleted calls ({deletedCalls.length})</CardTitle>
                <CardDescription>Soft-deleted calls kept for review.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {deletedCalls.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No deleted calls.</div>
                ) : (
                  deletedCalls.map((call) => (
                    <div
                      key={`deleted-${call.id}`}
                      className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{call.when}</div>
                        <Badge variant="outline" className="rounded-xl">
                          Deleted
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        From: {call.from}
                        {call.to ? ` • Receiver: ${call.to}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Caller: {call.callerName?.trim() ? call.callerName : "Unknown"}
                      </div>
                      <div className="mt-2 text-sm leading-5">{getSummaryText(call.summary)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* To Do */}
          <TabsContent value="todo" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Confirmed tasks</CardTitle>
                  <CardDescription>Accepted AI tasks that now require action.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {confirmedTasksLoading ? (
                    <div className="text-sm text-muted-foreground">Loading tasks…</div>
                  ) : confirmedTasksError ? (
                    <div className="text-sm text-red-600">{confirmedTasksError}</div>
                  ) : needsAction.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nothing pending.</div>
                  ) : (
                    needsAction.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-zinc-200 bg-white/80 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{c.title}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {c.description}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Call: {c.externalId} • From: {c.fromNumber} • Caller:{" "}
                              {c.callerName?.trim() ? c.callerName : "Unknown"}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Priority: {c.priority} • Status: {c.status} • Confidence:{" "}
                              {formatConfidence(c.confidence)}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => {
                              const target = calls.find((x) => x.id === c.externalId);
                              if (target) setSelected(target);
                            }}
                          >
                            Open call
                          </Button>
                        </div>
                      </div>
                  ))
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Quick actions</CardTitle>
                  <CardDescription>POC buttons (wire to backend).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selected ? (
                    <div className="text-sm text-muted-foreground">
                      Select a call to act on it.
                    </div>
                  ) : (
                    <>
                      <div className="text-sm">
                        <span className="font-medium">Selected:</span> {selected.id}
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <Button className="rounded-2xl" variant="outline">
                          <Phone className="h-4 w-4 mr-2" /> Call back
                        </Button>
                        <Button className="rounded-2xl" variant="outline">
                          <AlertTriangle className="h-4 w-4 mr-2" /> Mark needs follow-up
                        </Button>
                        <Button
                          className="rounded-2xl"
                          onClick={() =>
                            setCalls((prev) =>
                              prev.map((c) =>
                                c.id === selected.id
                                  ? {
                                      ...c,
                                      requiresAction: false,
                                      outcome: "Booked",
                                      priority: "Low",
                                    }
                                  : c
                              )
                            )
                          }
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" /> Mark resolved
                        </Button>
                      </div>

                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Insights */}
          <TabsContent value="insights" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Calls by day (sample)</CardTitle>
                  <CardDescription>Volume + average duration.</CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weekSeries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="calls" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Outcomes (sample)</CardTitle>
                  <CardDescription>What happened after calls.</CardDescription>
                </CardHeader>
                <CardContent className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outcomes}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide={false} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Operational notes</CardTitle>
                  <CardDescription>Turn these into product requirements.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">Quality</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Track language, confidence, and flagged misunderstandings.
                    </p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">Compliance</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Store transcripts safely; never capture card numbers in plain text.
                    </p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">Automation</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      When extraction is confident, auto-create a draft reservation.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="pt-2 text-xs text-muted-foreground">
          POC UI only. Wire to your backend: /api/calls, /api/recordings, /api/reservations.
        </div>
      </div>
    </div>
  );
}
