import AppNav from "@/components/AppNav";
import { requireSession } from "@/lib/session";

// Route-group layout that wraps every page under /(authed) with the top nav
// bar + a server-side session gate. Middleware already kicks unauthed users
// to /login, but we double-check here so that server components inside can
// assume a session exists (and to give a defense-in-depth barrier).

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppNav />
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
