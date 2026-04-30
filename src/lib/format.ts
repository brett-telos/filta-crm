// Small formatters shared across pages.

export function formatCurrency(
  value: number | string | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(n);
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  // Expect E.164 like +1XXXXXXXXXX
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return phone;
}

export function formatDateShort(
  d: Date | string | null | undefined,
): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(
  d: Date | string | null | undefined,
): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export const STAGE_LABEL: Record<string, string> = {
  new_lead: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

export const SERVICE_LABEL: Record<string, string> = {
  ff: "FiltaFry",
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

export const TERRITORY_LABEL: Record<string, string> = {
  fun_coast: "Fun Coast",
  space_coast: "Space Coast",
  unassigned: "Unassigned",
};

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  prospect: "Prospect",
  customer: "Customer",
  churned: "Churned",
  do_not_contact: "Do Not Contact",
};

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  visit: "Site Visit",
  note: "Note",
  task: "Task",
};
