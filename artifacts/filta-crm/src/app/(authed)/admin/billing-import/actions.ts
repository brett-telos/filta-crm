"use server";

// Billing CSV import actions — admin-only.
//
// Three actions form the pipeline:
//
//   uploadBillingImportAction(formData)
//     Receives an uploaded CSV, hashes it, parses, computes the diff
//     against current accounts, persists a billing_imports row in
//     'uploaded' status with diff_snapshot. Returns the new row id;
//     caller redirects to the preview page.
//
//   applyBillingImportAction({ id })
//     Re-loads the diff_snapshot from the row and writes the changes to
//     accounts.service_profile (and last_service_date proxied through the
//     same column). Marks the row 'applied' with counters. Idempotent:
//     re-applying the same hash short-circuits.
//
//   abortBillingImportAction({ id, notes? })
//     Marks an uploaded row 'aborted' so it stops showing as a pending
//     review. Doesn't delete — preserved for audit.
//
// All three are gated to admin role only. RLS enforces this at the DB
// layer; we also block at the action layer for a friendlier error.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, billingImports, withSession } from "@/db";
import { requireSession } from "@/lib/session";
import {
  computeBillingDiff,
  hashCsvBytes,
  normalizeCompany,
  parseBillingCsvText,
  type DiffResult,
  type ServiceProfile,
} from "@/lib/billing-csv";

function requireAdmin(role: string) {
  if (role !== "admin") {
    return "Admin role required to manage billing imports";
  }
  return null;
}

// ============================================================================
// UPLOAD
// ============================================================================

export type UploadResult = {
  ok: boolean;
  error?: string;
  billingImportId?: string;
  /** Pre-existing row if the same file hash was already uploaded. */
  existingRowId?: string;
};

export async function uploadBillingImportAction(
  formData: FormData,
): Promise<UploadResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded" };
  }
  if (file.size === 0) {
    return { ok: false, error: "File is empty" };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "File too large (max 5MB)" };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileHash = hashCsvBytes(buffer);
  const text = buffer.toString("utf-8");

  let csvTotals;
  try {
    csvTotals = parseBillingCsvText(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Parse failed: ${msg}` };
  }
  if (csvTotals.size === 0) {
    return {
      ok: false,
      error:
        "No customer rows recognized. Confirm this is a FiltaSymphony billing CSV.",
    };
  }

  return withSession(session, async (tx) => {
    // Reject if the same file (by hash) is already applied.
    const [alreadyApplied] = await tx
      .select({ id: billingImports.id })
      .from(billingImports)
      .where(
        and(
          eq(billingImports.fileHash, fileHash),
          eq(billingImports.status, "applied"),
        ),
      )
      .limit(1);
    if (alreadyApplied) {
      return {
        ok: false,
        error: "This exact file has already been applied",
        existingRowId: alreadyApplied.id,
      };
    }

    // If there's a non-applied upload of the same file, return that one
    // (operator can preview / apply / abort it directly).
    const [existing] = await tx
      .select({ id: billingImports.id })
      .from(billingImports)
      .where(
        and(
          eq(billingImports.fileHash, fileHash),
          inArray(billingImports.status, ["uploaded", "previewed"]),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: true, billingImportId: existing.id, existingRowId: existing.id };
    }

    // Pull current accounts for diff computation.
    const acctRows = await tx
      .select({
        id: accounts.id,
        companyName: accounts.companyName,
        serviceProfile: accounts.serviceProfile,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const accountsByKey = new Map<
      string,
      { id: string; companyName: string; serviceProfile: ServiceProfile | null }
    >();
    for (const a of acctRows) {
      accountsByKey.set(normalizeCompany(a.companyName), {
        id: a.id,
        companyName: a.companyName,
        serviceProfile: a.serviceProfile as ServiceProfile | null,
      });
    }

    const diff = computeBillingDiff(csvTotals, accountsByKey);

    const [inserted] = await tx
      .insert(billingImports)
      .values({
        fileName: file.name,
        fileHash,
        fileSizeBytes: file.size,
        uploadedByUserId: session.sub,
        status: "uploaded",
        rowsTotal: csvTotals.size,
        accountsInserted: diff.totals.insert,
        accountsUpdated: diff.totals.update,
        accountsSkipped: diff.totals.noOp + diff.totals.unmatched,
        mrrDelta: String(diff.totals.mrrDeltaSum),
        diffSnapshot: diff as unknown as Record<string, unknown>,
      })
      .returning({ id: billingImports.id });

    revalidatePath("/admin/billing-imports");
    revalidatePath("/admin/billing-import");

    return { ok: true, billingImportId: inserted.id };
  });
}

// ============================================================================
// APPLY
// ============================================================================

const ApplyInput = z.object({
  id: z.string().uuid(),
});

export type ApplyResult = {
  ok: boolean;
  error?: string;
  rowsUpdated?: number;
};

export async function applyBillingImportAction(
  input: z.infer<typeof ApplyInput>,
): Promise<ApplyResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const parsed = ApplyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  return withSession(session, async (tx) => {
    const [row] = await tx
      .select()
      .from(billingImports)
      .where(eq(billingImports.id, parsed.data.id))
      .limit(1);
    if (!row) return { ok: false, error: "Import not found" };
    if (row.status === "applied") {
      return { ok: false, error: "Already applied" };
    }
    if (row.status === "aborted") {
      return { ok: false, error: "Import was aborted; cannot apply" };
    }

    const diff = row.diffSnapshot as unknown as DiffResult | null;
    if (!diff || !diff.rows) {
      return { ok: false, error: "Diff snapshot missing or malformed" };
    }

    let updated = 0;
    for (const r of diff.rows) {
      if (r.action !== "update" || !r.accountId) continue;
      await tx
        .update(accounts)
        .set({
          serviceProfile: r.after as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, r.accountId));
      updated += 1;
    }

    const now = new Date();
    await tx
      .update(billingImports)
      .set({
        status: "applied",
        appliedAt: now,
        appliedByUserId: session.sub,
        accountsUpdated: updated,
        updatedAt: now,
      })
      .where(eq(billingImports.id, row.id));

    revalidatePath("/admin/billing-imports");
    revalidatePath("/admin/billing-import");
    revalidatePath("/dashboard");
    revalidatePath("/cross-sell");

    return { ok: true, rowsUpdated: updated };
  });
}

// ============================================================================
// ABORT
// ============================================================================

const AbortInput = z.object({
  id: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export type AbortResult = { ok: boolean; error?: string };

export async function abortBillingImportAction(
  input: z.infer<typeof AbortInput>,
): Promise<AbortResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const parsed = AbortInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  return withSession(session, async (tx) => {
    const [row] = await tx
      .select({ id: billingImports.id, status: billingImports.status })
      .from(billingImports)
      .where(eq(billingImports.id, parsed.data.id))
      .limit(1);
    if (!row) return { ok: false, error: "Import not found" };
    if (row.status === "applied") {
      return { ok: false, error: "Cannot abort an already-applied import" };
    }
    await tx
      .update(billingImports)
      .set({
        status: "aborted",
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(billingImports.id, row.id));

    revalidatePath("/admin/billing-imports");
    return { ok: true };
  });
}
