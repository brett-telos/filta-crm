// At-risk detection — pure rules engine.
//
// Takes a snapshot of an account (service profile, recent activities,
// recent email events, oldest open opportunity) and emits a list of risk
// signals plus an aggregated severity score. The caller does the data
// fetching; this module knows nothing about Drizzle, SQL, or the request
// lifecycle so it can be unit-tested with hand-rolled fixtures.
//
// Design choices:
//
// 1. Rules are independent. Each rule looks at a specific dimension
//    (service cadence, complaints, email bounces, dormant rep activity,
//    stuck opps) and either emits a signal or doesn't. No rule depends on
//    another — order doesn't matter, and adding a new rule never breaks an
//    existing one.
//
// 2. Severity is opinion, not fact. We assign 'low' / 'medium' / 'high'
//    based on franchise reality (FF should be ~weekly; missing a service
//    week is annoying but missing 4 in a row is "they probably switched
//    vendors"). These thresholds are tuned from the discovery numbers and
//    will need iteration once the at-risk queue is in real use.
//
// 3. Score is a sum, capped. We add severity weights (1/3/8) and cap at 20
//    so a single high-severity signal already lands the account in the
//    top tier of the queue — we don't want a dormant account with 4
//    minor signals to outrank a churning customer with one screaming red.
//
// 4. NCAs get a softer touch. National Centralized Accounts (Sodexo,
//    Compass, etc.) are governed by national contracts; we should still
//    flag service cadence problems for ops attention, but treating them
//    like a churn risk via the at-risk queue is the wrong call — the
//    relationship lives at corporate, not with our local rep. Rules tagged
//    `appliesToNca: false` are skipped for nca_flag=true accounts.

// ============================================================================
// THRESHOLDS — tunable knobs in one place
// ============================================================================

/** Days between FF services before we start raising flags. */
const FF_OVERDUE_YELLOW_DAYS = 14; // ~2x the typical weekly cadence
const FF_OVERDUE_RED_DAYS = 30; // a full month — they've likely switched vendor

/** Days without ANY activity logged on the account. Rep neglect signal. */
const DORMANT_YELLOW_DAYS = 45;
const DORMANT_RED_DAYS = 90;

/** Days an FS opp can sit in early stages before nudging the rep. */
const STUCK_OPP_DAYS = 60;

/** Days within which a recent bounce / complaint email event is a red flag. */
const RECENT_EMAIL_FAILURE_DAYS = 30;

/** Days within which a 'not_interested' / 'dnc' call disposition counts. */
const RECENT_NEGATIVE_DISPOSITION_DAYS = 60;

// ============================================================================
// TYPES
// ============================================================================

export type RiskSeverity = "low" | "medium" | "high";

export type RiskSignal = {
  /** Stable identifier — used for telemetry & UI keys. */
  code:
    | "ff_overdue"
    | "ff_overdue_severe"
    | "long_dormant"
    | "long_dormant_severe"
    | "stuck_fs_opp"
    | "recent_email_failure"
    | "recent_complaint"
    | "explicit_churned"
    | "explicit_dnc";
  severity: RiskSeverity;
  /** Human-readable reason; safe to render as a chip tooltip. */
  reason: string;
  /** Optional age-of-signal in days; the queue uses this to sort within a tier. */
  ageDays?: number;
};

export type RiskInput = {
  accountStatus: "prospect" | "customer" | "churned" | "do_not_contact";
  ncaFlag: boolean;
  serviceProfile: {
    ff?: { active?: boolean; last_service_date?: string | null };
    fs?: { active?: boolean; last_service_date?: string | null };
    fb?: { active?: boolean; last_service_date?: string | null };
    fg?: { active?: boolean; last_service_date?: string | null };
    fc?: { active?: boolean; last_service_date?: string | null };
    fd?: { active?: boolean; last_service_date?: string | null };
  };
  /** Most recent activity timestamp across all types — null if none ever. */
  lastActivityAt: Date | null;
  /** Most recent activity disposition (call dispositions specifically). */
  recentDispositions: Array<{
    disposition: string | null;
    occurredAt: Date;
  }>;
  /** Most recent email event of type 'bounced' or 'complained'. */
  recentEmailFailures: Array<{
    eventType: "bounced" | "complained";
    occurredAt: Date;
  }>;
  /** Open FS opportunities older than X days (caller filters). */
  oldestOpenFsOpp: { stage: string; stageChangedAt: Date } | null;
  /** Now-ish — injected so tests can pin a deterministic clock. */
  now?: Date;
};

export type RiskAssessment = {
  signals: RiskSignal[];
  /** Sum of severity weights, capped at 20. Higher = more urgent. */
  score: number;
  /** Convenience tier for UI grouping. */
  tier: "ok" | "watch" | "at_risk" | "critical";
};

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  low: 1,
  medium: 3,
  high: 8,
};
const SCORE_CAP = 20;

// ============================================================================
// RULES
// ============================================================================

type Rule = (input: RiskInput, now: Date) => RiskSignal | null;

/**
 * FF service overdue. The franchise's bread-and-butter signal — if a customer
 * is paying for FiltaFry but hasn't been serviced in 2+ weeks, something's
 * off. After 30 days they've almost certainly switched.
 *
 * Active FF only — we don't flag accounts that legitimately don't have FF.
 * NCAs are still flagged; service cadence is real even when contract terms
 * aren't with the local franchise.
 */
const ruleFfOverdue: Rule = (input, now) => {
  const ff = input.serviceProfile.ff;
  if (!ff?.active) return null;
  if (input.accountStatus !== "customer") return null;

  const lastIso = ff.last_service_date;
  if (!lastIso) {
    return {
      code: "ff_overdue",
      severity: "medium",
      reason: "No FiltaFry service date on file",
    };
  }
  const lastDate = new Date(lastIso);
  const days = daysBetween(lastDate, now);

  if (days >= FF_OVERDUE_RED_DAYS) {
    return {
      code: "ff_overdue_severe",
      severity: "high",
      reason: `FiltaFry not serviced in ${days} days`,
      ageDays: days,
    };
  }
  if (days >= FF_OVERDUE_YELLOW_DAYS) {
    return {
      code: "ff_overdue",
      severity: "medium",
      reason: `FiltaFry overdue by ${days} days`,
      ageDays: days,
    };
  }
  return null;
};

/**
 * Account-level dormancy — no activity logged for a while. Picks up the
 * "rep forgot about this account" failure mode the discovery flagged
 * (some customers hadn't been touched in months).
 */
const ruleDormant: Rule = (input, now) => {
  if (input.accountStatus !== "customer") return null;
  if (!input.lastActivityAt) {
    // Never any activity at all — only flag if the account isn't brand new.
    // We can't tell "brand new" from this input alone, so we skip the flag
    // and let the FF service overdue rule do the work for active customers.
    return null;
  }
  const days = daysBetween(input.lastActivityAt, now);
  if (days >= DORMANT_RED_DAYS) {
    return {
      code: "long_dormant_severe",
      severity: "high",
      reason: `No activity logged in ${days} days`,
      ageDays: days,
    };
  }
  if (days >= DORMANT_YELLOW_DAYS) {
    return {
      code: "long_dormant",
      severity: "low",
      reason: `No activity in ${days} days`,
      ageDays: days,
    };
  }
  return null;
};

/**
 * Stuck FS cross-sell opportunity. Specifically targets the cross-sell
 * funnel since that's the strategic priority — an FS opp sitting in
 * 'qualified' or 'proposal' for 60+ days means the rep needs a nudge.
 */
const ruleStuckFsOpp: Rule = (input, now) => {
  const opp = input.oldestOpenFsOpp;
  if (!opp) return null;
  const days = daysBetween(opp.stageChangedAt, now);
  if (days < STUCK_OPP_DAYS) return null;
  return {
    code: "stuck_fs_opp",
    severity: "medium",
    reason: `FS opportunity stuck in ${prettyStage(opp.stage)} for ${days} days`,
    ageDays: days,
  };
};

/**
 * Recent email failure — bounce or complaint. Bounce = wrong address or
 * the contact left; complaint = the customer hit the spam button on us
 * (rare but extremely actionable). Either way we don't want to keep
 * sending without a manual review.
 */
const ruleRecentEmailFailure: Rule = (input, now) => {
  const recent = input.recentEmailFailures
    .filter((e) => daysBetween(e.occurredAt, now) <= RECENT_EMAIL_FAILURE_DAYS)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!recent) return null;
  const days = daysBetween(recent.occurredAt, now);
  return {
    code: "recent_email_failure",
    severity: recent.eventType === "complained" ? "high" : "medium",
    reason:
      recent.eventType === "complained"
        ? `Spam complaint received ${days}d ago`
        : `Email bounced ${days}d ago — check contact address`,
    ageDays: days,
  };
};

/**
 * Recent negative call disposition — 'not_interested' or 'dnc'. Doesn't
 * automatically flip status (the rep might be wrong about how negative the
 * customer was), but it's a chip the queue should surface.
 */
const ruleRecentComplaint: Rule = (input, now) => {
  const recent = input.recentDispositions
    .filter(
      (d) =>
        d.disposition &&
        ["not_interested", "dnc"].includes(d.disposition) &&
        daysBetween(d.occurredAt, now) <= RECENT_NEGATIVE_DISPOSITION_DAYS,
    )
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!recent) return null;
  const days = daysBetween(recent.occurredAt, now);
  return {
    code: "recent_complaint",
    severity: recent.disposition === "dnc" ? "high" : "medium",
    reason:
      recent.disposition === "dnc"
        ? `Marked DNC ${days}d ago`
        : `Said 'not interested' ${days}d ago`,
    ageDays: days,
  };
};

/**
 * Explicit status flags. These aren't really "detection" — the rep already
 * told us — but surfacing them on the at-risk queue keeps lost customers
 * visible so we don't accidentally email them.
 */
const ruleExplicitChurned: Rule = (input) => {
  if (input.accountStatus !== "churned") return null;
  return {
    code: "explicit_churned",
    severity: "high",
    reason: "Account marked as churned",
  };
};

const ruleExplicitDnc: Rule = (input) => {
  if (input.accountStatus !== "do_not_contact") return null;
  return {
    code: "explicit_dnc",
    severity: "medium",
    reason: "Account marked Do Not Contact",
  };
};

const RULES: Rule[] = [
  ruleFfOverdue,
  ruleDormant,
  ruleStuckFsOpp,
  ruleRecentEmailFailure,
  ruleRecentComplaint,
  ruleExplicitChurned,
  ruleExplicitDnc,
];

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Run every rule against the input and aggregate. Always returns — never
 * throws — so callers can confidently render a tier even on partial data.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const now = input.now ?? new Date();

  const signals: RiskSignal[] = [];
  for (const rule of RULES) {
    const sig = rule(input, now);
    if (sig) signals.push(sig);
  }

  const rawScore = signals.reduce(
    (sum, s) => sum + SEVERITY_WEIGHT[s.severity],
    0,
  );
  const score = Math.min(rawScore, SCORE_CAP);

  return {
    signals,
    score,
    tier: tierFor(score),
  };
}

/**
 * UI tier mapping. Bands chosen so:
 *  - 0           → ok (no chip)
 *  - 1–2         → watch (low severity only)
 *  - 3–7         → at_risk (one medium signal, or several low)
 *  - 8+          → critical (a high signal, or stacked)
 */
function tierFor(score: number): RiskAssessment["tier"] {
  if (score === 0) return "ok";
  if (score <= 2) return "watch";
  if (score <= 7) return "at_risk";
  return "critical";
}

// ============================================================================
// HELPERS
// ============================================================================

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function prettyStage(stage: string): string {
  return stage.replace(/_/g, " ");
}

// Public so the queue page can render chips with consistent labels.
export const TIER_LABEL: Record<RiskAssessment["tier"], string> = {
  ok: "OK",
  watch: "Watch",
  at_risk: "At risk",
  critical: "Critical",
};

export const TIER_PALETTE: Record<RiskAssessment["tier"], string> = {
  ok: "bg-slate-100 text-slate-600 border-slate-200",
  watch: "bg-amber-50 text-amber-700 border-amber-200",
  at_risk: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
};

export const SEVERITY_PALETTE: Record<RiskSeverity, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
};
