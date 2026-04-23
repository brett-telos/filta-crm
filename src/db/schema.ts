// Filta CRM — Database Schema
// Models the Account / Contact / Opportunity / Activity / User ontology
// described in Section 5 of Filta-CRM-Design.md.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ============================================================================
// ENUMS
// ============================================================================

export const territoryEnum = pgEnum("territory", [
  "fun_coast",
  "space_coast",
  "unassigned",
]);

export const accountStatusEnum = pgEnum("account_status", [
  "prospect",
  "customer",
  "churned",
  "do_not_contact",
]);

export const industrySegmentEnum = pgEnum("industry_segment", [
  "restaurant",
  "yacht_club",
  "hotel",
  "school_university",
  "healthcare",
  "corporate_dining",
  "senior_living",
  "aerospace_defense",
  "entertainment_venue",
  "government_military",
  "other",
]);

export const leadSourceEnum = pgEnum("lead_source", [
  "filta_corporate",
  "referral",
  "web",
  "trade_show",
  "cold_outbound",
  "existing_customer",
  "other",
]);

// Note: FG here is FiltaGold (deep clean service). The billing CSV's "FG"
// line items for "Oil Sold to Customer" are tracked separately, not here.
export const serviceTypeEnum = pgEnum("service_type", [
  "ff", // FiltaFry — core oil filtration
  "fs", // FiltaClean / FiltaShield — steam cleaning
  "fb", // FiltaBio — used oil collection
  "fg", // FiltaGold — deep clean (launched Oct 2025)
  "fc", // FiltaCool — refrigeration seal replacement
  "fd", // FiltaDrain — drain foam (brand abbrev per guidelines)
]);

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "new_lead",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
]);

export const lostReasonEnum = pgEnum("lost_reason", [
  "price",
  "decision_maker_left",
  "went_with_competitor",
  "no_need",
  "timing",
  "corporate_owns_decision",
  "no_fryers",
  "not_genuine",
  "other",
]);

export const decisionMakerRoleEnum = pgEnum("decision_maker_role", [
  "economic_buyer",
  "champion",
  "user",
  "blocker",
  "unknown",
]);

export const preferredChannelEnum = pgEnum("preferred_channel", [
  "email",
  "phone",
  "text",
  "in_person",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "call",
  "email",
  "meeting",
  "visit",
  "note",
  "task",
]);

export const activityDirectionEnum = pgEnum("activity_direction", [
  "inbound",
  "outbound",
  "na",
]);

// Covers the Filta dispositions we profiled (Number Disconnected, Booked
// Site-Evaluation, Not Interested, No Answer, various Call Back variations,
// etc.) plus our custom ones.
export const callDispositionEnum = pgEnum("call_disposition", [
  "connected",
  "left_voicemail",
  "no_answer",
  "wrong_number",
  "number_disconnected",
  "line_busy",
  "not_interested",
  "dnc",
  "callback_scheduled",
  "meeting_booked",
  "site_eval_booked",
  "demo_booked",
  "dm_unavailable",
  "language_barrier",
  "corporate_decision",
  "chain_decision",
  "not_qualified",
  "other",
]);

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "sales_rep",
  "technician",
]);

export const userTerritoryScopeEnum = pgEnum("user_territory_scope", [
  "fun_coast",
  "space_coast",
  "both",
]);

// Task status — open (due or future), done (completed), snoozed (pushed to a
// later due_date). Snoozed tasks show up again when their due_date lands.
export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "done",
  "snoozed",
]);

// Priority — used to sort the Today view within each bucket. Kept small and
// ordinal (low/normal/high). Default 'normal'.
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
]);

// Email / message infra (Week 3.1). Email status tracks the send lifecycle
// from "queued in our DB" → "handed to Resend" → "delivered / bounced /
// complained". We keep it conservative: Resend gives us more detailed
// webhook events, but these five buckets are what the sales rep actually
// cares about.
export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
]);

// Template purpose — what this template is for. Drives which UI surfaces
// show it (cross-sell dashboard pulls fs_cross_sell; future flows will add
// their own enum values).
export const messageTemplatePurposeEnum = pgEnum("message_template_purpose", [
  "fs_cross_sell",
  "general_followup",
  "proposal_sent",
  "other",
]);

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: userRoleEnum("role").notNull().default("sales_rep"),
    territory: userTerritoryScopeEnum("territory").notNull().default("both"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
  }),
);

// ============================================================================
// ACCOUNTS (the business)
// ============================================================================

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    dbaName: text("dba_name"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    state: text("state").default("FL"),
    zip: text("zip"),
    county: text("county"),
    territory: territoryEnum("territory").notNull().default("unassigned"),
    phone: text("phone"), // E.164 normalized
    phoneRaw: text("phone_raw"), // original format preserved
    website: text("website"),
    industrySegment: industrySegmentEnum("industry_segment"),
    fryerCount: integer("fryer_count"),
    accountStatus: accountStatusEnum("account_status")
      .notNull()
      .default("prospect"),
    ncaFlag: boolean("nca_flag").notNull().default(false),
    ncaName: text("nca_name"), // e.g. 'Sodexo', 'Compass', 'Avendra'
    leadSource: leadSourceEnum("lead_source")
      .notNull()
      .default("filta_corporate"),
    // service_profile JSONB shape:
    // { ff: { active: bool, monthly_revenue: num, last_service_date: date },
    //   fs: { ... }, fb: { ... }, fg: { ... }, fc: { ... }, fd: { ... } }
    serviceProfile: jsonb("service_profile")
      .notNull()
      .default(sql`'{}'::jsonb`),
    filtaRecordId: text("filta_record_id"), // traceability to Filta Symphony
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    companyNameIdx: index("accounts_company_name_idx").on(t.companyName),
    phoneIdx: index("accounts_phone_idx").on(t.phone),
    territoryIdx: index("accounts_territory_idx").on(t.territory),
    statusIdx: index("accounts_status_idx").on(t.accountStatus),
    ownerIdx: index("accounts_owner_idx").on(t.ownerUserId),
    filtaRecordIdIdx: uniqueIndex("accounts_filta_record_id_unique")
      .on(t.filtaRecordId)
      .where(sql`${t.filtaRecordId} IS NOT NULL`),
  }),
);

// ============================================================================
// CONTACTS (the people)
// ============================================================================

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name"), // denormalized for search
    title: text("title"),
    decisionMakerRole: decisionMakerRoleEnum("decision_maker_role").default(
      "unknown",
    ),
    email: text("email"),
    phoneDirect: text("phone_direct"),
    phoneMobile: text("phone_mobile"),
    preferredChannel: preferredChannelEnum("preferred_channel"),
    notes: text("notes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    accountIdx: index("contacts_account_idx").on(t.accountId),
    fullNameIdx: index("contacts_full_name_idx").on(t.fullName),
    emailIdx: index("contacts_email_idx").on(t.email),
  }),
);

// ============================================================================
// OPPORTUNITIES (the deal)
// ============================================================================

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    primaryContactId: uuid("primary_contact_id").references(() => contacts.id),
    name: text("name").notNull(), // auto: '{Account} — {Service Type}'
    serviceType: serviceTypeEnum("service_type").notNull(),
    stage: pipelineStageEnum("stage").notNull().default("new_lead"),
    estimatedValueAnnual: numeric("estimated_value_annual", {
      precision: 12,
      scale: 2,
    }),
    estimatedValueOverride: boolean("estimated_value_override")
      .notNull()
      .default(false),
    expectedCloseDate: date("expected_close_date"),
    actualCloseDate: date("actual_close_date"),
    competitorInDeal: text("competitor_in_deal"),
    lostReason: lostReasonEnum("lost_reason"),
    lostReasonNotes: text("lost_reason_notes"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    accountIdx: index("opportunities_account_idx").on(t.accountId),
    stageIdx: index("opportunities_stage_idx").on(t.stage),
    serviceIdx: index("opportunities_service_idx").on(t.serviceType),
    ownerIdx: index("opportunities_owner_idx").on(t.ownerUserId),
    closeDateIdx: index("opportunities_close_date_idx").on(t.expectedCloseDate),
  }),
);

// ============================================================================
// ACTIVITIES (the touchpoint)
// ============================================================================

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    type: activityTypeEnum("type").notNull(),
    direction: activityDirectionEnum("direction").notNull().default("na"),
    disposition: callDispositionEnum("disposition"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    durationMinutes: integer("duration_minutes"),
    subject: text("subject"),
    body: text("body"),
    attachments: jsonb("attachments")
      .notNull()
      .default(sql`'[]'::jsonb`),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("activities_account_idx").on(t.accountId),
    opportunityIdx: index("activities_opportunity_idx").on(t.opportunityId),
    typeIdx: index("activities_type_idx").on(t.type),
    occurredAtIdx: index("activities_occurred_at_idx").on(t.occurredAt),
  }),
);

// ============================================================================
// TASKS (the follow-up)
// ============================================================================

// Tasks are the "next step" for an account or opportunity — call back on
// Tuesday, send FS quote, drop by after lunch. They surface on the Today
// view and on account/opp detail pages. Completing a task auto-writes an
// activity of type 'task' so the timeline stays the single source of truth
// for "what happened".
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // When a task is tied to a specific deal (e.g. "follow up on FS
    // proposal") we link the opp so it can surface on the pipeline card too.
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    // Who owns the follow-up. Defaults to the creator but can be reassigned.
    assigneeUserId: uuid("assignee_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: date("due_date").notNull(),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Snooze history is useful diagnostic signal — if a task has been snoozed
    // 3+ times, it probably isn't actually going to happen. We just count,
    // not log timestamps, to keep it cheap.
    snoozeCount: integer("snooze_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    // When this task was auto-created by another flow (e.g. FS cross-sell
    // email send auto-spawns a 5-day follow-up), we record the source so we
    // can find them later for reporting / cleanup.
    autoSource: text("auto_source"), // e.g. 'fs_cross_sell_send'
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("tasks_account_idx").on(t.accountId),
    opportunityIdx: index("tasks_opportunity_idx").on(t.opportunityId),
    assigneeIdx: index("tasks_assignee_idx").on(t.assigneeUserId),
    // Composite index for the Today view's most common query:
    // "open tasks for user X ordered by due date".
    assigneeStatusDueIdx: index("tasks_assignee_status_due_idx").on(
      t.assigneeUserId,
      t.status,
      t.dueDate,
    ),
    statusDueIdx: index("tasks_status_due_idx").on(t.status, t.dueDate),
  }),
);

// ============================================================================
// MESSAGE TEMPLATES (reusable copy for outbound email)
// ============================================================================

// A small library of send-ready email templates, keyed by purpose. The body
// columns store Handlebars-ish `{{placeholders}}` that the send action
// fills in at dispatch time (account name, first name, etc.).
//
// We keep both an HTML and a plain-text version because Resend — and most
// inboxes — want both. The plain version is what spam filters sniff first.
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: messageTemplatePurposeEnum("purpose").notNull(),
    // Human-readable key like 'fs_cross_sell_v1' — what the UI picks by.
    // Unique so we can upsert a template by key during seeding.
    key: text("key").notNull(),
    name: text("name").notNull(),
    subjectTemplate: text("subject_template").notNull(),
    bodyHtmlTemplate: text("body_html_template").notNull(),
    bodyTextTemplate: text("body_text_template").notNull(),
    // Active templates show in the send UI; inactive ones stay around so
    // previously-sent emails still resolve their template name in history.
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyUnique: uniqueIndex("message_templates_key_unique").on(t.key),
    purposeIdx: index("message_templates_purpose_idx").on(t.purpose),
  }),
);

// ============================================================================
// EMAIL SENDS (the sent record — one row per recipient)
// ============================================================================

// Every outbound email we send gets a row here. One row per recipient, so a
// single campaign to 20 contacts is 20 rows. Linked to account (required),
// opportunity (optional — cross-sell sends land against a synthetic opp),
// contact (who we sent to), and template (what copy we used).
//
// We also write a companion `activities` row with type='email',
// direction='outbound' for each send so the account timeline reflects it.
export const emailSends = pgTable(
  "email_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    // The template we sent (or null if the rep wrote a one-off from scratch
    // — future flow, not used in v1).
    templateId: uuid("template_id").references(() => messageTemplates.id, {
      onDelete: "set null",
    }),
    // Sender identity at time of send. Captured per-row so changing the
    // default later doesn't re-write history.
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmail: text("to_email").notNull(),
    // Snapshot of rendered subject/body at send time — templates can change
    // but history should not.
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),
    status: emailStatusEnum("status").notNull().default("queued"),
    // Resend returns an ID for each accepted message; we store it so we can
    // match inbound webhooks later.
    providerMessageId: text("provider_message_id"),
    providerError: text("provider_error"),
    sentByUserId: uuid("sent_by_user_id")
      .notNull()
      .references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("email_sends_account_idx").on(t.accountId),
    contactIdx: index("email_sends_contact_idx").on(t.contactId),
    opportunityIdx: index("email_sends_opportunity_idx").on(t.opportunityId),
    sentByIdx: index("email_sends_sent_by_idx").on(t.sentByUserId),
    statusIdx: index("email_sends_status_idx").on(t.status),
    providerMessageIdIdx: uniqueIndex("email_sends_provider_message_id_unique")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
  }),
);

// ============================================================================
// SUPPORTING TABLES
// ============================================================================

// City -> county -> territory mapping for auto-routing
export const cityCountyMapping = pgTable(
  "city_county_mapping",
  {
    cityNormalized: text("city_normalized").primaryKey(), // upper-cased, trimmed
    cityDisplay: text("city_display").notNull(),
    county: text("county").notNull(), // 'Volusia' | 'Brevard' | etc.
    territory: territoryEnum("territory").notNull(),
  },
);

// Single-row config for pricing used in auto-estimation
export const servicePricingConfig = pgTable("service_pricing_config", {
  id: integer("id").primaryKey().default(1),
  ffPerFryerPerMonth: numeric("ff_per_fryer_per_month", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("300.00"),
  fsPerQuarter: numeric("fs_per_quarter", { precision: 10, scale: 2 })
    .notNull()
    .default("750.00"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const knownCompetitors = pgTable("known_competitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  aliases: jsonb("aliases")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Password reset tokens — short-lived, single-use.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256(token)
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("password_reset_tokens_token_hash_unique").on(
      t.tokenHash,
    ),
    userIdx: index("password_reset_tokens_user_idx").on(t.userId),
  }),
);

// Audit log for Account/Contact/Opportunity mutations
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id").notNull(),
    action: text("action").notNull(), // INSERT | UPDATE | DELETE
    actorUserId: uuid("actor_user_id").references(() => users.id),
    diff: jsonb("diff")
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recordIdx: index("audit_log_record_idx").on(t.tableName, t.recordId),
    actorIdx: index("audit_log_actor_idx").on(t.actorUserId),
  }),
);

// ============================================================================
// RELATIONS
// ============================================================================

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  contacts: many(contacts),
  opportunities: many(opportunities),
  activities: many(activities),
  owner: one(users, {
    fields: [accounts.ownerUserId],
    references: [users.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  account: one(accounts, {
    fields: [contacts.accountId],
    references: [accounts.id],
  }),
  activities: many(activities),
}));

export const opportunitiesRelations = relations(
  opportunities,
  ({ one, many }) => ({
    account: one(accounts, {
      fields: [opportunities.accountId],
      references: [accounts.id],
    }),
    primaryContact: one(contacts, {
      fields: [opportunities.primaryContactId],
      references: [contacts.id],
    }),
    owner: one(users, {
      fields: [opportunities.ownerUserId],
      references: [users.id],
    }),
    activities: many(activities),
  }),
);

export const activitiesRelations = relations(activities, ({ one }) => ({
  account: one(accounts, {
    fields: [activities.accountId],
    references: [accounts.id],
  }),
  contact: one(contacts, {
    fields: [activities.contactId],
    references: [contacts.id],
  }),
  opportunity: one(opportunities, {
    fields: [activities.opportunityId],
    references: [opportunities.id],
  }),
  owner: one(users, {
    fields: [activities.ownerUserId],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  account: one(accounts, {
    fields: [tasks.accountId],
    references: [accounts.id],
  }),
  opportunity: one(opportunities, {
    fields: [tasks.opportunityId],
    references: [opportunities.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeUserId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [tasks.createdByUserId],
    references: [users.id],
  }),
}));

export const messageTemplatesRelations = relations(
  messageTemplates,
  ({ one, many }) => ({
    createdBy: one(users, {
      fields: [messageTemplates.createdByUserId],
      references: [users.id],
    }),
    sends: many(emailSends),
  }),
);

export const emailSendsRelations = relations(emailSends, ({ one }) => ({
  account: one(accounts, {
    fields: [emailSends.accountId],
    references: [accounts.id],
  }),
  contact: one(contacts, {
    fields: [emailSends.contactId],
    references: [contacts.id],
  }),
  opportunity: one(opportunities, {
    fields: [emailSends.opportunityId],
    references: [opportunities.id],
  }),
  template: one(messageTemplates, {
    fields: [emailSends.templateId],
    references: [messageTemplates.id],
  }),
  sentBy: one(users, {
    fields: [emailSends.sentByUserId],
    references: [users.id],
  }),
}));

// ============================================================================
// TYPES
// ============================================================================

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type EmailSend = typeof emailSends.$inferSelect;
export type NewEmailSend = typeof emailSends.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ServiceProfile = {
  ff?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
  fs?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
  fb?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
  fg?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
  fc?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
  fd?: { active: boolean; monthly_revenue?: number; last_service_date?: string };
};
