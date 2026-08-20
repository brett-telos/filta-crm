DO $$ BEGIN
 CREATE TYPE "public"."account_status" AS ENUM('prospect', 'customer', 'churned', 'do_not_contact');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."activity_direction" AS ENUM('inbound', 'outbound', 'na');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."activity_type" AS ENUM('call', 'email', 'meeting', 'visit', 'note', 'task');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."call_disposition" AS ENUM('connected', 'left_voicemail', 'no_answer', 'wrong_number', 'number_disconnected', 'line_busy', 'not_interested', 'dnc', 'callback_scheduled', 'meeting_booked', 'site_eval_booked', 'demo_booked', 'dm_unavailable', 'language_barrier', 'corporate_decision', 'chain_decision', 'not_qualified', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."decision_maker_role" AS ENUM('economic_buyer', 'champion', 'user', 'blocker', 'unknown');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."industry_segment" AS ENUM('restaurant', 'yacht_club', 'hotel', 'school_university', 'healthcare', 'corporate_dining', 'senior_living', 'aerospace_defense', 'entertainment_venue', 'government_military', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."lead_source" AS ENUM('filta_corporate', 'referral', 'web', 'trade_show', 'cold_outbound', 'existing_customer', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."lost_reason" AS ENUM('price', 'decision_maker_left', 'went_with_competitor', 'no_need', 'timing', 'corporate_owns_decision', 'no_fryers', 'not_genuine', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."pipeline_stage" AS ENUM('new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."preferred_channel" AS ENUM('email', 'phone', 'text', 'in_person');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."service_type" AS ENUM('ff', 'fs', 'fb', 'fg', 'fc', 'df');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."territory" AS ENUM('fun_coast', 'space_coast', 'unassigned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_role" AS ENUM('admin', 'sales_rep', 'technician');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_territory_scope" AS ENUM('fun_coast', 'space_coast', 'both');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"dba_name" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state" text DEFAULT 'FL',
	"zip" text,
	"county" text,
	"territory" "territory" DEFAULT 'unassigned' NOT NULL,
	"phone" text,
	"phone_raw" text,
	"website" text,
	"industry_segment" "industry_segment",
	"fryer_count" integer,
	"account_status" "account_status" DEFAULT 'prospect' NOT NULL,
	"nca_flag" boolean DEFAULT false NOT NULL,
	"nca_name" text,
	"lead_source" "lead_source" DEFAULT 'filta_corporate' NOT NULL,
	"service_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filta_record_id" text,
	"owner_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"type" "activity_type" NOT NULL,
	"direction" "activity_direction" DEFAULT 'na' NOT NULL,
	"disposition" "call_disposition",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_minutes" integer,
	"subject" text,
	"body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "city_county_mapping" (
	"city_normalized" text PRIMARY KEY NOT NULL,
	"city_display" text NOT NULL,
	"county" text NOT NULL,
	"territory" "territory" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"full_name" text,
	"title" text,
	"decision_maker_role" "decision_maker_role" DEFAULT 'unknown',
	"email" text,
	"phone_direct" text,
	"phone_mobile" text,
	"preferred_channel" "preferred_channel",
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "known_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"primary_contact_id" uuid,
	"name" text NOT NULL,
	"service_type" "service_type" NOT NULL,
	"stage" "pipeline_stage" DEFAULT 'new_lead' NOT NULL,
	"estimated_value_annual" numeric(12, 2),
	"estimated_value_override" boolean DEFAULT false NOT NULL,
	"expected_close_date" date,
	"actual_close_date" date,
	"competitor_in_deal" text,
	"lost_reason" "lost_reason",
	"lost_reason_notes" text,
	"owner_user_id" uuid,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_pricing_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ff_per_fryer_per_month" numeric(10, 2) DEFAULT '300.00' NOT NULL,
	"fs_per_quarter" numeric(10, 2) DEFAULT '750.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "user_role" DEFAULT 'sales_rep' NOT NULL,
	"territory" "user_territory_scope" DEFAULT 'both' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_company_name_idx" ON "accounts" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_phone_idx" ON "accounts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_territory_idx" ON "accounts" USING btree ("territory");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_status_idx" ON "accounts" USING btree ("account_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_owner_idx" ON "accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_filta_record_id_unique" ON "accounts" USING btree ("filta_record_id") WHERE "accounts"."filta_record_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_account_idx" ON "activities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_opportunity_idx" ON "activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_type_idx" ON "activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_occurred_at_idx" ON "activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_account_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_full_name_idx" ON "contacts" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_account_idx" ON "opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_stage_idx" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_service_idx" ON "opportunities" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_owner_idx" ON "opportunities" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_close_date_idx" ON "opportunities" USING btree ("expected_close_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");