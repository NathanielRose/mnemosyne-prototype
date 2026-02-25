import { useEffect, useMemo, useState } from "react";
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
  Bell,
  X,
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

  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday} ${time}`;
};

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
  extracted?: Partial<ReservationDraft>;
  requiresAction: boolean;

  // Optional extras (POC)
  tag?: string; // e.g., "Wedding"
  rateEUR?: number; // show for booked calls
};

type ApiCall = {
  id: string;
  externalId: string;
  startedAt: string;
  fromNumber: string;
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
  requiresAction: boolean;
  tag: string | null;
  rateEur: number | string | null;
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

const priorityPill = (p: CallRecord["priority"]) => {
  if (p === "High") return <Badge variant="destructive">High</Badge>;
  if (p === "Medium") return <Badge variant="secondary">Medium</Badge>;
  return <Badge variant="outline">Low</Badge>;
};

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

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: any;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
          <div className="h-10 w-10 rounded-2xl border flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
        </div>
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
  return (
    <button
      className="w-full text-left"
      onClick={() => onSelect(call)}
      aria-label={`Open call ${call.id}`}
    >
      <Card
        className={
          isSelected
            ? "rounded-2xl bg-purple-50 shadow hover:shadow-md transition border-purple-200"
            : "rounded-2xl bg-muted/25 shadow hover:shadow-md transition border-muted/60"
        }
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold">{call.when}</div>
                <Badge variant="outline" className="rounded-xl">
                  {call.detectedLanguage ? call.detectedLanguage : call.language}
                </Badge>
                {outcomeBadge(call.outcome)}
                {call.tag ? (
                  <Badge variant="outline" className="rounded-xl">
                    {call.tag}
                  </Badge>
                ) : null}
                {call.requiresAction ? (
                  <Badge className="rounded-xl bg-yellow-100 text-yellow-900 border border-yellow-200">
                    <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Needs action
                  </Badge>
                ) : (
                  <Badge variant="outline" className="rounded-xl">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Clean
                  </Badge>
                )}
              </div>

              <div className="mt-2 text-sm text-muted-foreground truncate flex items-center gap-1">
                <Phone className="h-4 w-4 shrink-0" /> From: {call.from}
              </div>

              <div className="mt-2 text-sm leading-5 line-clamp-2">{call.summary}</div>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {call.outcome === "Booked" && typeof call.rateEUR === "number" ? (
                <Badge variant="outline" className="rounded-xl">
                  €{call.rateEUR}/night
                </Badge>
              ) : null}
              {priorityPill(call.priority)}
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> {formatSecs(call.durationSec)}
              </div>
              <div className="text-sm text-muted-foreground" title={call.id}>
                SID:{call.id.slice(-6)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function BookingWorkflow({
  call,
  onSave,
}: {
  call: CallRecord;
  onSave: (draft: ReservationDraft) => void;
}) {
  const initial: ReservationDraft = {
    guestName: call.extracted?.guestName || "",
    phone: call.from || "",
    email: "",
    checkIn: call.extracted?.checkIn || "",
    checkOut: call.extracted?.checkOut || "",
    adults:
      typeof call.extracted?.adults === "number" ? call.extracted!.adults! : 2,
    children:
      typeof call.extracted?.children === "number" ? call.extracted!.children! : 0,
    roomType: (call.extracted?.roomType as any) || "Double",
    rateType: (call.extracted?.rateType as any) || "Standard",
    notes: call.extracted?.notes || "",
    status: (call.extracted?.status as any) || "Draft",
  };

  const [draft, setDraft] = useState<ReservationDraft>(initial);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-muted-foreground">Reservation workflow</div>
          <div className="text-lg font-semibold flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" /> ARXONTIKO Hotel & Restaurant
          </div>
        </div>
        <Badge variant="outline" className="rounded-xl">
          From call {call.id}
        </Badge>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Guest name</Label>
          <Input
            value={draft.guestName}
            onChange={(e) => setDraft((d) => ({ ...d, guestName: e.target.value }))}
            placeholder="e.g., Maria Papadopoulou"
          />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            value={draft.phone}
            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Email</Label>
          <Input
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder="optional"
          />
        </div>

        <div className="space-y-2">
          <Label>Check-in</Label>
          <Input
            type="date"
            value={draft.checkIn}
            onChange={(e) => setDraft((d) => ({ ...d, checkIn: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Check-out</Label>
          <Input
            type="date"
            value={draft.checkOut}
            onChange={(e) => setDraft((d) => ({ ...d, checkOut: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label>Adults</Label>
          <Input
            type="number"
            min={1}
            value={draft.adults}
            onChange={(e) => setDraft((d) => ({ ...d, adults: Number(e.target.value) }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Children</Label>
          <Input
            type="number"
            min={0}
            value={draft.children}
            onChange={(e) => setDraft((d) => ({ ...d, children: Number(e.target.value) }))}
          />
        </div>

        <div className="space-y-2">
          <Label>Room type</Label>
          <Select
            value={draft.roomType}
            onValueChange={(v: any) => setDraft((d) => ({ ...d, roomType: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select room type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Single">Single</SelectItem>
              <SelectItem value="Double">Double</SelectItem>
              <SelectItem value="Triple">Triple</SelectItem>
              <SelectItem value="Suite">Suite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Rate type</Label>
          <Select
            value={draft.rateType}
            onValueChange={(v: any) => setDraft((d) => ({ ...d, rateType: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select rate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Standard">Standard</SelectItem>
              <SelectItem value="Non-refundable">Non-refundable</SelectItem>
              <SelectItem value="Half-board">Half-board</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Notes</Label>
          <Textarea
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="Parking, late check-in, dietary needs, etc."
            className="min-h-[96px]"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Status</Label>
          <Select
            value={draft.status}
            onValueChange={(v: any) => setDraft((d) => ({ ...d, status: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Pending confirmation">Pending confirmation</SelectItem>
              <SelectItem value="Confirmed">Confirmed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => navigator.clipboard?.writeText(JSON.stringify(draft, null, 2))}
        >
          <Download className="h-4 w-4 mr-2" /> Copy JSON
        </Button>
        <Button onClick={() => onSave(draft)}>
          <ChevronRight className="h-4 w-4 mr-2" /> Save reservation
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        POC note: this does not charge cards or finalize bookings. Keep payment out of
        transcripts.
      </p>
    </div>
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
    requiresAction: row.requiresAction,
    tag: row.tag ?? undefined,
    rateEUR: Number.isFinite(rate) ? rate : undefined,
  };
}

export default function App() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [selected, setSelected] = useState<CallRecord | null>(null);
  const [query, setQuery] = useState<string>("");
  const [transcriptExpanded, setTranscriptExpanded] = useState<boolean>(false);
  const [transcriptVariant, setTranscriptVariant] = useState<"original" | "en">("en");
  const [hasMoreCalls, setHasMoreCalls] = useState<boolean>(false);
  const [loadingMoreCalls, setLoadingMoreCalls] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadCalls = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/calls?limit=${PAGE_SIZE + 1}&offset=0`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Failed to load calls: ${res.status}`);
        const data = (await res.json()) as ApiCall[];
        if (!Array.isArray(data)) throw new Error("Invalid calls payload");

        const hasMore = data.length > PAGE_SIZE;
        const mapped = data.slice(0, PAGE_SIZE).map(mapApiCall);

        if (!cancelled) {
          setCalls(mapped);
          setSelected(mapped[0] ?? null);
          setHasMoreCalls(hasMore);
        }
      } catch {
        if (!cancelled) {
          setCalls([]);
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
    return filtered.filter((c) => c.requiresAction);
  }, [filtered]);

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

  const handleSaveReservation = (draft: ReservationDraft) => {
    if (!selected) return;
    setCalls((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              outcome: draft.status === "Confirmed" ? "Booked" : c.outcome,
              requiresAction: draft.status === "Confirmed" ? false : true,
              extracted: {
                ...c.extracted,
                guestName: draft.guestName || c.extracted?.guestName,
                checkIn: draft.checkIn,
                checkOut: draft.checkOut,
                adults: draft.adults,
                children: draft.children,
                roomType: draft.roomType,
                rateType: draft.rateType,
                status: draft.status,
                notes: draft.notes,
              },
            }
          : c
      )
    );
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
                      Mnemosyne AI
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
                  <Button size="sm" className="rounded-full">
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
          <Stat label="Calls this week" value={`${callsThisWeek}`} icon={Phone} />
          <Stat label="Avg call length" value={`${formatSecs(avgLen)}`} icon={Clock} />
          <Stat
            label="Needs action"
            value={`${calls.filter((c) => c.requiresAction).length}`}
            icon={ListTodo}
          />
          <Stat
            label="Bookings (sample)"
            value={`${calls.filter((c) => c.outcome === "Booked").length}`}
            icon={CalendarCheck}
          />
        </div>

        <Tabs defaultValue="timeline" className="w-full">
          <TabsList className="rounded-2xl bg-purple-50">
            <TabsTrigger
              value="timeline"
              className="rounded-2xl data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Timeline
            </TabsTrigger>
            <TabsTrigger
              value="todo"
              className="rounded-2xl data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              To do
            </TabsTrigger>
            <TabsTrigger
              value="insights"
              className="rounded-2xl data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Insights
            </TabsTrigger>
          </TabsList>

          {/* Timeline */}
          <TabsContent value="timeline" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">
                    Last calls ({last6.length})
                  </CardTitle>
                  <CardDescription>Click a call to view details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {last6.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
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
                        <div className="pt-1">
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
                        <div className="font-semibold">{selected.when}</div>
                        {outcomeBadge(selected.outcome)}
                      </div>

                      <div className="text-sm text-muted-foreground">
                        Caller: {selected.from}
                        {selected.to ? ` • Receiver: ${selected.to}` : ""}
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Duration</span>
                        <span className="font-medium">{formatSecs(selected.durationSec)}</span>
                      </div>

                      <Separator />

                      <div>
                        <div className="text-sm font-medium">Summary</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {selected.summary}
                        </div>
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
                                    ? "bg-purple-600 text-white"
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
                                    ? "bg-purple-600 text-white"
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

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-xl">
                            {selected.detectedLanguage ? selected.detectedLanguage : selected.language}
                          </Badge>
                          {priorityPill(selected.priority)}
                        </div>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className="rounded-2xl" disabled={!selected.requiresAction}>
                              <CalendarCheck className="h-4 w-4 mr-2" /> Create booking
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl rounded-2xl">
                            <DialogHeader>
                              <DialogTitle>Booking workflow</DialogTitle>
                              <DialogDescription>
                                Confirm extracted details, then save.
                              </DialogDescription>
                            </DialogHeader>
                            <BookingWorkflow call={selected} onSave={handleSaveReservation} />
                            <DialogFooter>
                              <Button variant="outline" className="rounded-2xl">
                                Close
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
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

          {/* To Do */}
          <TabsContent value="todo" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Calls requiring action</CardTitle>
                  <CardDescription>Follow-up, missed calls, and pending bookings.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {needsAction.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nothing pending.</div>
                  ) : (
                    needsAction.map((c) => (
                    <CallRow
                      key={c.id}
                      call={c}
                      onSelect={setSelected}
                      isSelected={selected?.id === c.id}
                    />
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

                      <Separator />

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button className="rounded-2xl" disabled={!selected.requiresAction}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Open booking workflow
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl rounded-2xl">
                          <DialogHeader>
                            <DialogTitle>Booking workflow</DialogTitle>
                            <DialogDescription>
                              Turn a call into a reservation record.
                            </DialogDescription>
                          </DialogHeader>
                          <BookingWorkflow call={selected} onSave={handleSaveReservation} />
                        </DialogContent>
                      </Dialog>
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
