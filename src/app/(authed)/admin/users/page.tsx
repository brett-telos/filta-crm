// /admin/users — admin-only user management.
//
// Lists every user with name, email, role, territory, active flag, and
// last login. Two main interactions:
//   - "Invite user" button (top right) opens an inline form to add a
//     new team member; on submit, sends an invite email with a set-
//     password link.
//   - Per-row inline controls to change role, territory, deactivate /
//     reactivate, or resend the invite link.
//
// Self-protection: the current admin can't demote themselves out of
// admin or deactivate themselves (server-side enforcement in the
// action; UI just hides the dangerous controls).

import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, users } from "@/db";
import { requireSession } from "@/lib/session";
import InviteUserForm from "./InviteUserForm";
import {
  RoleSelect,
  TerritorySelect,
  ActiveToggle,
  ResendInvite,
} from "./UserRowControls";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  sales_rep: "Sales Rep",
  technician: "Technician",
};

const TERRITORY_LABEL: Record<string, string> = {
  fun_coast: "Fun Coast",
  space_coast: "Space Coast",
  both: "Both",
};

export default async function AdminUsersPage() {
  const session = await requireSession();
  if (session.role !== "admin") notFound();

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      territory: users.territory,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.active), desc(users.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Users
        </h1>
        <p className="text-sm text-slate-600">
          Manage who has access to the Filta CRM. Invitees get a set-
          password link that&apos;s valid for 7 days.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Invite a new user
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          They&apos;ll get an email with a set-password link. Re-inviting
          an existing email rotates the link instead of erroring.
        </p>
        <div className="mt-4">
          <InviteUserForm />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Team ({userRows.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Territory</th>
                <th className="px-5 py-3">Active</th>
                <th className="px-5 py-3">Last login</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {userRows.map((u) => {
                const isSelf = u.id === session.sub;
                return (
                  <tr
                    key={u.id}
                    className={u.active ? "" : "bg-slate-50/60 text-slate-500"}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">
                        {[u.firstName, u.lastName].filter(Boolean).join(" ") ||
                          "(no name)"}
                        {isSelf ? (
                          <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                            You
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleSelect
                        userId={u.id}
                        value={u.role}
                        disabledForSelf={isSelf && u.role === "admin"}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <TerritorySelect
                        userId={u.id}
                        value={u.territory}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <ActiveToggle
                        userId={u.id}
                        active={u.active}
                        disabledForSelf={isSelf}
                      />
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt as Date).toLocaleString()
                        : <span className="italic">never</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!isSelf ? (
                        <ResendInvite userId={u.id} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Roles: <strong>Admin</strong> can manage users + run billing
        imports + access all data. <strong>Sales Rep</strong> can manage
        their territory&apos;s accounts/leads/quotes. <strong>Technician</strong>{" "}
        is reserved for future field-mode access.
      </p>
    </div>
  );
}
