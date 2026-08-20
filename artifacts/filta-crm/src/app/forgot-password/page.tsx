import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ForgotForm from "./ForgotForm";

export const metadata = {
  title: "Forgot password — Filta CRM",
};

export default async function ForgotPasswordPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            We'll generate a reset link for your account
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <ForgotForm />
        </div>
      </div>
    </main>
  );
}
