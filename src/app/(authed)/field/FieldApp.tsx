"use client";

// Field Mode client app. One component owns the whole phone experience:
// pipeline list + search, the lead card with the dictation-first update box,
// stage chips, and the weekly report. Desktop users can use it too (it's
// just a narrow column), but every decision here is phone-first: big touch
// targets, one-thumb reach, nothing more than two taps deep.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  MapPin,
  MessageSquare,
  Mic,
  Phone,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  FIELD_STAGES,
  fieldStageForDb,
  SYMPHONY_FUNNEL_LABEL,
  type FieldStageKey,
} from "@/lib/field-stages";
import { formatPhone, formatRelative } from "@/lib/format";
import {
  getFieldReportAction,
  getLeadCardAction,
  quickUpdateAction,
  searchLeadsAction,
  setFieldStageAction,
  type FieldLeadCard,
  type FieldLeadRow,
  type FieldReport,
} from "./actions";

const TERRITORY_SHORT: Record<string, string> = {
  fun_coast: "Fun Coast",
  space_coast: "Space Coast",
  unassigned: "Unassigned",
};

// ---------------------------------------------------------------------------

export default function FieldApp({
  initialLeads,
  userFirstName,
}: {
  initialLeads: FieldLeadRow[];
  userFirstName: string;
}) {
  const [tab, setTab] = useState<"pipeline" | "report">("pipeline");
  const [leads, setLeads] = useState<FieldLeadRow[]>(initialLeads);
  const [chip, setChip] = useState<FieldStageKey | "all">("all");
  const [q, setQ] = useState("");
  const [searchRows, setSearchRows] = useState<FieldLeadRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const fireConfetti = useCallback(() => {
    setConfetti(true);
    setTimeout(() => setConfetti(false), 2600);
  }, []);

  // Debounced server search once the query is 2+ chars.
  useEffect(() => {
    if (q.trim().length < 2) {
      setSearchRows(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchLeadsAction({ q: q.trim() });
      setSearching(false);
      if (res.ok && res.rows) setSearchRows(res.rows);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const visible = useMemo(() => {
    const base = searchRows ?? leads;
    if (chip === "all" || searchRows) return base;
    const def = FIELD_STAGES.find((s) => s.key === chip)!;
    return base.filter((l) => def.dbValues.includes(l.stage as never));
  }, [leads, searchRows, chip]);

  const chipCounts = useMemo(() => {
    const counts = new Map<FieldStageKey, number>();
    for (const l of leads) {
      const k = fieldStageForDb(l.stage).key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [leads]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  function onLeadStageChanged(id: string, newDbStage: string) {
    const patch = (rows: FieldLeadRow[]) =>
      rows.map((l) =>
        l.id === id
          ? { ...l, stage: newDbStage, stageChangedAt: new Date().toISOString() }
          : l,
      );
    setLeads(patch);
    setSearchRows((rows) => (rows ? patch(rows) : rows));
  }

  return (
    <div className="mx-auto max-w-md">
      {/* Greeting bar */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-sm text-filta-cool-gray">
            {greeting}, {userFirstName}
          </p>
          <h1 className="text-xl font-extrabold uppercase tracking-wide text-filta-blue">
            Field Mode
          </h1>
        </div>
        {/* Segmented tab control */}
        <div className="flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
          <button
            onClick={() => setTab("pipeline")}
            className={`rounded-full px-4 py-1.5 transition ${
              tab === "pipeline"
                ? "bg-filta-blue text-white shadow"
                : "text-filta-cool-gray"
            }`}
          >
            Pipeline
          </button>
          <button
            onClick={() => setTab("report")}
            className={`rounded-full px-4 py-1.5 transition ${
              tab === "report"
                ? "bg-filta-blue text-white shadow"
                : "text-filta-cool-gray"
            }`}
          >
            This Week
          </button>
        </div>
      </div>

      {tab === "report" ? (
        <ReportView />
      ) : openId ? (
        <LeadCardView
          accountId={openId}
          onBack={() => setOpenId(null)}
          onStageChanged={onLeadStageChanged}
          showToast={showToast}
          fireConfetti={fireConfetti}
        />
      ) : (
        <>
          {/* Search */}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search any lead: name, city, phone"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-[16px] shadow-sm outline-none focus:border-filta-blue focus:ring-2 focus:ring-filta-blue/20"
            />
            {searching && (
              <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-filta-blue" />
            )}
          </div>

          {/* Stage chips (hidden while searching — search reaches everything) */}
          {!searchRows && (
            <div className="scrollbar-none -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
              <Chip
                label={`Working (${leads.length})`}
                active={chip === "all"}
                activeClass="bg-filta-dark-blue text-white border-filta-dark-blue"
                onClick={() => setChip("all")}
              />
              {FIELD_STAGES.filter((s) => !["new", "won", "lost"].includes(s.key)).map(
                (s) => (
                  <Chip
                    key={s.key}
                    label={`${s.shortLabel} (${chipCounts.get(s.key) ?? 0})`}
                    active={chip === s.key}
                    activeClass={s.activeClass}
                    onClick={() => setChip(chip === s.key ? "all" : s.key)}
                  />
                ),
              )}
            </div>
          )}

          {searchRows && (
            <p className="mb-2 px-1 text-xs text-filta-cool-gray">
              Searching all leads — {searchRows.length} match
              {searchRows.length === 1 ? "" : "es"}
              {searchRows.length === 30 ? " (showing first 30)" : ""}
            </p>
          )}

          {/* Lead list */}
          <div className="space-y-2.5 pb-24">
            {visible.map((l) => (
              <LeadRow key={l.id} lead={l} onOpen={() => setOpenId(l.id)} />
            ))}
            {visible.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-filta-cool-gray">
                {searchRows
                  ? "No leads match that search."
                  : "Nothing here yet. Search above to find any lead and get it moving."}
              </div>
            )}
          </div>
        </>
      )}

      {/* Toast */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-filta-dark-blue px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity duration-300 ${
          toast ? "opacity-100" : "opacity-0"
        }`}
      >
        {toast}
      </div>

      {confetti && <Confetti />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Chip({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition active:scale-95 ${
        active
          ? activeClass
          : "border-slate-200 bg-white text-filta-cool-gray shadow-sm"
      }`}
    >
      {label}
    </button>
  );
}

function LeadRow({
  lead,
  onOpen,
}: {
  lead: FieldLeadRow;
  onOpen: () => void;
}) {
  const stage = fieldStageForDb(lead.stage);
  const days = Math.floor(
    (Date.now() - new Date(lead.stageChangedAt).getTime()) / 86_400_000,
  );
  return (
    <button
      onClick={onOpen}
      className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] active:bg-filta-light-blue/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold text-slate-900">
            {lead.companyName}
          </h3>
          <p className="mt-0.5 text-xs text-filta-cool-gray">
            {lead.city ?? "City unknown"} · {TERRITORY_SHORT[lead.territory]}
            {lead.fryerCount ? ` · ${lead.fryerCount} fryers` : ""}
          </p>
        </div>
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${stage.dotClass} mt-1.5`}
        />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${stage.activeClass}`}
        >
          {stage.label}
        </span>
        <span className="text-[11px] text-slate-400">
          {days === 0 ? "moved today" : `${days}d in stage`}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------------

function LeadCardView({
  accountId,
  onBack,
  onStageChanged,
  showToast,
  fireConfetti,
}: {
  accountId: string;
  onBack: () => void;
  onStageChanged: (id: string, dbStage: string) => void;
  showToast: (m: string) => void;
  fireConfetti: () => void;
}) {
  const [card, setCard] = useState<FieldLeadCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState("");
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [movingStage, setMovingStage] = useState<FieldStageKey | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const load = useCallback(async () => {
    const res = await getLeadCardAction({ accountId });
    if (res.ok && res.card) setCard(res.card);
    else setError(res.error ?? "Could not load lead");
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveUpdate() {
    const body = update.trim();
    if (body.length < 2) {
      showToast("Say or type a little more first");
      return;
    }
    setSaving(true);
    const res = await quickUpdateAction({ accountId, body });
    setSaving(false);
    if (!res.ok) {
      showToast(res.error ?? "Could not save");
      return;
    }
    setUpdate("");
    showToast("Saved — the team can see it");
    // Optimistic feed insert, then refresh in the background.
    setCard((c) =>
      c
        ? {
            ...c,
            feed: [
              {
                id: `tmp-${Date.now()}`,
                type: "visit",
                subject: "Field update",
                body,
                occurredAt: new Date().toISOString(),
                ownerName: "You",
              },
              ...c.feed,
            ],
          }
        : c,
    );
    void load();
  }

  function dictate() {
    type SR = {
      new (): {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const w = window as unknown as {
      SpeechRecognition?: SR;
      webkitSpeechRecognition?: SR;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      showToast("Use the mic key on your keyboard");
      document.getElementById("field-update-box")?.focus();
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setUpdate((u) => (u ? `${u} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      showToast("Mic unavailable — use the keyboard mic");
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function moveStage(key: FieldStageKey) {
    if (!card) return;
    const def = FIELD_STAGES.find((s) => s.key === key)!;
    const current = fieldStageForDb(card.stage);
    if (current.key === key) return;
    setMovingStage(key);
    const res = await setFieldStageAction({
      accountId,
      stage: def.writeValue,
    });
    setMovingStage(null);
    if (!res.ok) {
      showToast(res.error ?? "Could not move stage");
      return;
    }
    setCard((c) =>
      c
        ? {
            ...c,
            stage: def.writeValue,
            stageChangedAt: new Date().toISOString(),
            accountStatus: key === "won" ? "customer" : c.accountStatus,
          }
        : c,
    );
    onStageChanged(accountId, def.writeValue);
    if (key === "won") {
      fireConfetti();
      showToast(`${card.companyName} is a customer — enter it in Symphony!`);
    } else if (key === "scheduled") {
      showToast("Scheduled! The Symphony card below is ready to enter.");
    } else {
      showToast(`Stage: ${def.label}`);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
        <button onClick={onBack} className="mt-3 block font-bold text-filta-blue">
          Back to pipeline
        </button>
      </div>
    );
  }
  if (!card) {
    return (
      <div className="flex items-center justify-center py-20 text-filta-blue">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const stage = fieldStageForDb(card.stage);
  const telHref = card.phoneRaw ?? card.phone;
  const addr = [card.addressLine1, card.city, card.state, card.zip]
    .filter(Boolean)
    .join(", ");
  const isScheduledOrWon = stage.key === "scheduled" || stage.key === "won";

  return (
    <div className="pb-24">
      <button
        onClick={onBack}
        className="mb-2 flex items-center gap-1 py-1 text-sm font-bold text-filta-blue"
      >
        <ChevronLeft className="h-4 w-4" /> Pipeline
      </button>

      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-extrabold text-slate-900">
          {card.companyName}
        </h2>
        <p className="mt-0.5 text-xs text-filta-cool-gray">
          {card.city ?? "City unknown"} · {TERRITORY_SHORT[card.territory]}
          {card.fryerCount ? ` · ${card.fryerCount} fryers` : ""}
          {card.ncaFlag ? ` · NCA${card.ncaName ? `: ${card.ncaName}` : ""}` : ""}
        </p>

        {/* One-tap actions */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <ActionButton
            href={telHref ? `tel:${telHref.replace(/[^\d+]/g, "")}` : undefined}
            icon={<Phone className="h-4 w-4" />}
            label="Call"
          />
          <ActionButton
            href={telHref ? `sms:${telHref.replace(/[^\d+]/g, "")}` : undefined}
            icon={<MessageSquare className="h-4 w-4" />}
            label="Text"
          />
          <ActionButton
            href={
              addr
                ? `https://maps.apple.com/?q=${encodeURIComponent(
                    `${card.companyName}, ${addr}`,
                  )}`
                : undefined
            }
            icon={<MapPin className="h-4 w-4" />}
            label="Map"
          />
        </div>

        {/* Stage mover */}
        <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-filta-cool-gray">
          Stage — tap to move
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FIELD_STAGES.map((s) => {
            const active = stage.key === s.key;
            return (
              <button
                key={s.key}
                onClick={() => moveStage(s.key)}
                disabled={movingStage !== null}
                className={`rounded-full border px-3 py-2 text-xs font-bold transition active:scale-95 disabled:opacity-60 ${
                  active
                    ? s.activeClass
                    : "border-slate-200 bg-white text-filta-cool-gray"
                }`}
              >
                {movingStage === s.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  s.shortLabel
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* THE update box */}
      <div className="mt-3 rounded-2xl border-2 border-dashed border-service-ff bg-amber-50 p-4">
        <label
          htmlFor="field-update-box"
          className="flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-wide text-amber-800"
        >
          <Sparkles className="h-4 w-4" /> New update
        </label>
        <textarea
          id="field-update-box"
          value={update}
          onChange={(e) => setUpdate(e.target.value)}
          placeholder="Tap here, hit the mic on your keyboard, and talk through the visit…"
          className="mt-2 w-full resize-y rounded-xl border border-amber-200 bg-white p-3 text-[16px] outline-none focus:border-filta-blue focus:ring-2 focus:ring-filta-blue/20"
          rows={4}
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={dictate}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-3 text-sm font-bold transition active:scale-95 ${
              listening
                ? "animate-pulse border-red-500 bg-red-500 text-white"
                : "border-amber-300 bg-white text-amber-800"
            }`}
          >
            <Mic className="h-4 w-4" />
            {listening ? "Listening… tap to stop" : "Dictate"}
          </button>
          <button
            onClick={saveUpdate}
            disabled={saving}
            className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-filta-green py-3 text-sm font-extrabold text-white shadow transition active:scale-95 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save update
          </button>
        </div>
      </div>

      {/* Symphony file card — glows once scheduled */}
      <div
        className={`mt-3 rounded-2xl border p-4 ${
          isScheduledOrWon
            ? "border-service-fs bg-teal-50"
            : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-filta-cool-gray">
            Symphony file card
          </h4>
          {isScheduledOrWon && (
            <span className="rounded-full bg-service-fs px-2.5 py-1 text-[10px] font-extrabold uppercase text-white">
              Ready to enter
            </span>
          )}
        </div>
        <dl className="mt-2 divide-y divide-slate-100 text-sm">
          <CardField k="Contact" v={card.primaryContact?.fullName} />
          <CardField k="Title" v={card.primaryContact?.title} />
          <CardField
            k="Phone"
            v={formatPhone(card.phoneRaw ?? card.phone) || undefined}
          />
          <CardField k="Email" v={card.primaryContact?.email} />
          <CardField k="Address" v={addr || undefined} />
          <CardField k="County" v={card.county} />
          <CardField k="Website" v={card.website} />
          <CardField
            k="Fryers"
            v={card.fryerCount != null ? String(card.fryerCount) : undefined}
          />
          <CardField k="Sales funnel" v={SYMPHONY_FUNNEL_LABEL[stage.key]} />
          <CardField
            k="NCA"
            v={card.ncaFlag ? (card.ncaName ?? "Yes") : "No"}
          />
          <CardField k="Symphony ID" v={card.filtaRecordId} />
        </dl>
        {isScheduledOrWon && (
          <p className="mt-2 text-xs text-teal-800">
            {card.filtaRecordId
              ? "This lead already exists in Symphony — update that record instead of creating a new one."
              : "Service is on the calendar: key this card into Symphony now (or the office will, from the weekly export)."}
          </p>
        )}
        <a
          href="/api/field/symphony-export"
          className="mt-2 inline-block text-xs font-bold text-filta-blue underline underline-offset-2"
        >
          Download all Scheduled leads as Symphony CSV
        </a>
      </div>

      {/* Activity feed */}
      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-filta-cool-gray">
          Activity — whole team sees this
        </h4>
        <div className="mt-3 space-y-3">
          {card.feed.length === 0 && (
            <p className="text-sm text-slate-400">
              No notes yet. Be the first.
            </p>
          )}
          {card.feed.map((f) => (
            <div key={f.id} className="border-l-2 border-filta-light-blue pl-3">
              <p className="text-[11px] font-semibold text-slate-400">
                {formatRelative(f.occurredAt)}
                {f.ownerName ? ` · ${f.ownerName}` : ""}
                {f.subject && f.subject !== "Field update"
                  ? ` · ${f.subject}`
                  : ""}
              </p>
              {f.body && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                  {f.body}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  href,
  icon,
  label,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
}) {
  if (!href) {
    return (
      <span className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 py-3 text-sm font-bold text-slate-300">
        {icon} {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-xl border border-filta-blue/20 bg-filta-light-blue py-3 text-sm font-bold text-filta-blue-dark transition active:scale-95"
    >
      {icon} {label}
    </a>
  );
}

function CardField({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-24 flex-shrink-0 text-filta-cool-gray">{k}</dt>
      <dd className={`min-w-0 break-words font-medium ${v ? "text-slate-900" : "text-slate-300"}`}>
        {v || "—"}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly report
// ---------------------------------------------------------------------------

function ReportView() {
  const [report, setReport] = useState<FieldReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await getFieldReportAction();
      if (res.ok && res.report) setReport(res.report);
      else setError(res.error ?? "Could not load report");
    })();
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex items-center justify-center py-20 text-filta-blue">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  const maxPipe = Math.max(1, ...report.pipeline.map((p) => p.count));

  return (
    <div className="space-y-3 pb-24">
      {/* Leaderboard */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-filta-cool-gray">
          Milestones · {fmt(report.weekStartIso)} to {fmt(report.weekEndIso)}
        </h4>
        {report.reps.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            Quiet week so far. First update wins the trophy.
          </p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-1.5 text-left font-bold">Rep</th>
                <th className="py-1.5 text-center font-bold">Contacted</th>
                <th className="py-1.5 text-center font-bold">Quoted</th>
                <th className="py-1.5 text-center font-bold">Sched.</th>
                <th className="py-1.5 text-center font-bold">Won</th>
                <th className="py-1.5 text-center font-bold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {report.reps.map((r, i) => (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="py-2 font-bold text-slate-900">
                    <span className="flex items-center gap-1">
                      {i === 0 && (
                        <Trophy className="h-3.5 w-3.5 text-service-ff" />
                      )}
                      {r.name}
                    </span>
                  </td>
                  <Num v={r.contacted} />
                  <Num v={r.quoted} />
                  <Num v={r.scheduled} />
                  <Num v={r.won} highlight />
                  <Num v={r.updates} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pipeline stock */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-filta-cool-gray">
          Pipeline right now
        </h4>
        <div className="mt-3 space-y-2">
          {FIELD_STAGES.filter((s) =>
            ["contacted", "quote", "scheduled"].includes(s.key),
          ).map((s) => {
            const count = report.pipeline
              .filter((p) => s.dbValues.includes(p.stage as never))
              .reduce((a, p) => a + p.count, 0);
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span className="w-24 flex-shrink-0 text-xs font-bold text-filta-cool-gray">
                  {s.shortLabel}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${s.dotClass} transition-all`}
                    style={{ width: `${Math.max(4, (count / maxPipe) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm font-extrabold text-slate-900">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Changelog */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-filta-cool-gray">
          This week&apos;s notes — whole team
        </h4>
        <div className="mt-3 space-y-3">
          {report.changelog.length === 0 && (
            <p className="text-sm text-slate-400">No notes logged yet this week.</p>
          )}
          {report.changelog.map((c, i) => (
            <div key={i} className="border-l-2 border-filta-light-blue pl-3">
              <p className="text-[11px] font-semibold text-slate-400">
                {formatRelative(c.occurredAt)} · {c.ownerName} ·{" "}
                <span className="font-bold text-filta-blue">{c.companyName}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Num({ v, highlight }: { v: number; highlight?: boolean }) {
  return (
    <td
      className={`py-2 text-center ${
        v === 0
          ? "text-slate-300"
          : highlight
            ? "font-extrabold text-filta-green"
            : "font-bold text-slate-800"
      }`}
    >
      {v}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Confetti — tiny dependency-free celebration when a deal is Won.
// ---------------------------------------------------------------------------

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: (i * 37 + 13) % 100,
        delay: ((i * 89) % 40) / 100,
        duration: 1.6 + ((i * 53) % 90) / 100,
        color: ["#1595C8", "#71BF3B", "#FFC425", "#00A98F", "#6CADDE"][i % 5],
        size: 6 + ((i * 31) % 7),
        rot: (i * 67) % 360,
      })),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-[-20px] block animate-confetti-fall"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.45,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
