"use client";

// Thin client wrapper around the nav item list so we can highlight the active
// route with usePathname(). Kept tiny on purpose — AppNav stays a server
// component for session access; this ships only what needs the pathname.

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  href: string;
  label: string;
  // Optional small count badge (e.g. open follow-ups on /today). Falsy or
  // zero renders nothing so the nav stays quiet when the queue is empty.
  badge?: number;
  // Whether to flag this badge as urgent (e.g. overdue tasks). Urgent =
  // rose; normal = filta-blue.
  badgeUrgent?: boolean;
};

export function NavLinks({
  items,
  layout,
}: {
  items: Item[];
  layout: "desktop" | "mobile";
}) {
  const pathname = usePathname() || "/";

  const baseDesktop =
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors";
  const baseMobile =
    "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors";

  return (
    <>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)) ||
          (item.href !== "/dashboard" && pathname === item.href);

        const showBadge = typeof item.badge === "number" && item.badge > 0;
        // Badge color logic:
        //  - urgent + inactive → rose pill
        //  - normal + inactive → filta-blue pill
        //  - active (nav item selected) → white pill so it reads against blue bg
        const badgeCls = active
          ? "bg-white/90 text-filta-blue"
          : item.badgeUrgent
            ? "bg-rose-100 text-rose-800"
            : "bg-filta-light-blue text-filta-blue";

        const content = (
          <>
            <span>{item.label}</span>
            {showBadge && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${badgeCls}`}
              >
                {item.badge}
              </span>
            )}
          </>
        );

        if (layout === "desktop") {
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${baseDesktop} ${
                active
                  ? "bg-filta-blue text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {content}
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${baseMobile} ${
              active
                ? "bg-filta-blue text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {content}
          </Link>
        );
      })}
    </>
  );
}
