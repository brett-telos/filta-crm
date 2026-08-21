import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { checkResetTokenAction } from "./actions";
import ResetForm from "./ResetForm";

export const metadata = {
  title: "Choose a new password — Filta CRM",
};

export default async function ResetPasswordPage({
  params,
}: {
  params: { token: string };
}) {
  // Logged-in users probably shouldn't be here; send them to the app, but
  // don't block in case they're helping another user.
  const session = await getSession();
  if (session) redirect("/");

  const { valid } = await checkResetTokenAction(params.token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Set a new password
          </h1>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {valid ? (
            <ResetForm token={params.token} />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                This reset link is invalid or has expired.
              </div>
              <Link
                href="/forgot-password"
                className="block text-center text-slate-600 hover:text-slate-900"
              >
                Request a new one
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
