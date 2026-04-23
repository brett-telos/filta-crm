import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign in — Filta CRM",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { from?: string };
}) {
  // If already authenticated, bounce to the landing page (or the original
  // destination if they still have ?from=).
  const session = await getSession();
  if (session) {
    redirect(searchParams?.from ?? "/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-filta-light-blue px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <Image
            src="/brand/filta-logo.svg"
            alt="Filta"
            width={160}
            height={139}
            priority
            className="h-20 w-auto"
          />
          <p className="mt-3 text-sm font-medium uppercase tracking-wider text-filta-dark-blue">
            CRM · Sign in
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm from={searchParams?.from} />
        </div>

        <p className="mt-4 text-center text-xs text-filta-cool-gray">
          Fun Coast &amp; Space Coast — internal use only
        </p>
      </div>
    </main>
  );
}
