// Field Mode stage vocabulary.
//
// The sales team agreed on a 5-stage pipeline plus Lost for day-to-day field
// use (Aug 2026, Brett/Ron/Will/Sam): New Lead → Contacted → Quote Shared →
// Service Scheduled → Won (In Symphony), with Lost / On Hold off to the side.
//
// The database keeps the original 7-value pipeline_stage enum untouched (no
// migration, /leads and /pipeline unaffected). Field Mode presents a MAPPED
// view of it:
//
//   field stage          db value(s) shown        db value written on tap
//   -------------------  -----------------------  -----------------------
//   New Lead             new_lead                 new_lead
//   Contacted            contacted, qualified     contacted
//   Quote Shared         proposal                 proposal
//   Service Scheduled    negotiation              negotiation
//   Won (In Symphony)    closed_won               closed_won (via convert)
//   Lost / On Hold       closed_lost              closed_lost
//
// 'qualified' folds into Contacted on read so nothing already in the funnel
// gets stranded; we simply stop writing 'qualified' from Field Mode.
// 'negotiation' is repurposed as Service Scheduled — for this franchise there
// is no drawn-out negotiation step; once terms are agreed the milestone that
// matters is "first service is on the calendar."

export type DbStage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export type FieldStageKey =
  | "new"
  | "contacted"
  | "quote"
  | "scheduled"
  | "won"
  | "lost";

export const FIELD_STAGES: {
  key: FieldStageKey;
  label: string;
  shortLabel: string;
  dbValues: DbStage[];
  writeValue: DbStage;
  /** Tailwind classes for the active chip / pill. Brand + sub-brand colors. */
  activeClass: string;
  dotClass: string;
}[] = [
  {
    key: "new",
    label: "New Lead",
    shortLabel: "New",
    dbValues: ["new_lead"],
    writeValue: "new_lead",
    activeClass: "bg-slate-600 text-white border-slate-600",
    dotClass: "bg-slate-400",
  },
  {
    key: "contacted",
    label: "Contacted",
    shortLabel: "Contacted",
    dbValues: ["contacted", "qualified"],
    writeValue: "contacted",
    activeClass: "bg-filta-blue text-white border-filta-blue",
    dotClass: "bg-filta-blue",
  },
  {
    key: "quote",
    label: "Quote Shared",
    shortLabel: "Quote",
    dbValues: ["proposal"],
    writeValue: "proposal",
    activeClass: "bg-service-ff text-slate-900 border-service-ff",
    dotClass: "bg-service-ff",
  },
  {
    key: "scheduled",
    label: "Service Scheduled",
    shortLabel: "Scheduled",
    dbValues: ["negotiation"],
    writeValue: "negotiation",
    activeClass: "bg-service-fs text-white border-service-fs",
    dotClass: "bg-service-fs",
  },
  {
    key: "won",
    label: "Won (In Symphony)",
    shortLabel: "Won",
    dbValues: ["closed_won"],
    writeValue: "closed_won",
    activeClass: "bg-filta-green text-white border-filta-green",
    dotClass: "bg-filta-green",
  },
  {
    key: "lost",
    label: "Lost / On Hold",
    shortLabel: "Lost/Hold",
    dbValues: ["closed_lost"],
    writeValue: "closed_lost",
    activeClass: "bg-slate-400 text-white border-slate-400",
    dotClass: "bg-slate-300",
  },
];

export function fieldStageForDb(db: string): (typeof FIELD_STAGES)[number] {
  return (
    FIELD_STAGES.find((s) => s.dbValues.includes(db as DbStage)) ??
    FIELD_STAGES[0]
  );
}

/** Map a db stage to Symphony's Sales Funnel vocabulary for the file card. */
export const SYMPHONY_FUNNEL_LABEL: Record<FieldStageKey, string> = {
  new: "Lead",
  contacted: "Qualified Lead",
  quote: "Completed Meeting",
  scheduled: "Completed Meeting (create customer record)",
  won: "Customer",
  lost: "Lead (inactive)",
};
