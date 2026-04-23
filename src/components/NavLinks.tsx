"use client";

// Thin client wrapper around the nav item list so we can highlight the active
// route with usePathname(). Kept tiny on purpose — AppNav stays a server
// component for session access; this ships only what needs the pathname.

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

export function NavLinks({
  items,
  layout,
}: {
  items: Item[];
  layout: "desktop" | "mobile";
}) {
  const pathname = usePathname() || "/";

  const baseDesktop =
    "rounded-md px-2 py-1 text-sm transition-colors";
  const baseMobile =
    "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors";

  return (
    <>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)) ||
          (item.href !== "/dashboard" && pathname === item.href);

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
              {item.label}
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
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
