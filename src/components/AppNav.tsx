import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getTaskCountsForUser } from "@/app/(authed)/tasks/actions";
import { NavLinks } from "./NavLinks";

// Top nav bar rendered on all authed pages. Server component so we can read
// the session without a client roundtrip. Logout goes through a POST form so
// it works without JS and can clear the cookie server-side. The link list
// itself is a small client child (NavLinks) so it can highlight the active
// route via usePathname() without turning this whole header into a client
// component.

export default async function AppNav() {
  const session = await getSession();

  // Task badge next to "Today": overdue + due-today combined. We only pull
  // counts when the user is signed in; unauthenticated visitors never hit
  // this path anyway (middleware guards /authed routes).
  let todayBadge = 0;
  let todayUrgent = false;
  if (session) {
    try {
      const counts = await getTaskCountsForUser();
      todayBadge = counts.overdue + counts.today;
      todayUrgent = counts.overdue > 0;
    } catch {
      // Swallow — a failing badge shouldn't break the nav. The Today page
      // itself will show the real error if the query is broken.
    }
  }

  const NAV = [
    { href: "/dashboard", label: "Home" },
    {
      href: "/today",
      label: "Today",
      badge: todayBadge,
      badgeUrgent: todayUrgent,
    },
    { href: "/accounts", label: "Accounts" },
    { href: "/pipeline", label: "Pipeline" },
    { href: "/cross-sell", label: "Cross-Sell" },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            aria-label="Filta CRM — go to dashboard"
            className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-filta-blue"
          >
            {/* Glyph shows on mobile only; full logotype on sm+ */}
            <Image
              src="/brand/filta-glyph.svg"
              alt=""
              width={32}
              height={20}
              priority
              className="h-7 w-auto sm:hidden"
            />
            <Image
              src="/brand/filta-logo.svg"
              alt="Filta"
              width={160}
              height={139}
              priority
              className="hidden h-9 w-auto sm:block"
            />
            <span className="hidden text-xs font-medium uppercase tracking-wider text-slate-500 sm:inline">
              CRM
            </span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <NavLinks items={NAV} layout="desktop" />
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {session ? (
            <>
              <div className="hidden text-right sm:block">
                <div className="font-medium text-slate-900">{session.email}</div>
                <div className="text-xs text-slate-500">
                  {session.role} · {formatTerritory(session.territory)}
                </div>
              </div>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-filta-blue px-3 py-1.5 text-sm text-white hover:bg-filta-blue-dark"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Mobile nav row */}
      <nav className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-3 py-2 text-sm md:hidden">
        <NavLinks items={NAV} layout="mobile" />
      </nav>
    </header>
  );
}

function formatTerritory(t: "fun_coast" | "space_coast" | "both"): string {
  if (t === "both") return "All territories";
  if (t === "fun_coast") return "Fun Coast";
  return "Space Coast";
}
