"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  List,
  Mail,
  PlusCircle,
  Settings,
  TrendingUp,
} from "lucide-react";

const MOBILE_NAV_ITEMS = [
  { key: "home", label: "Home", href: "/dashboard", icon: BarChart3 },
  { key: "trends", label: "Trends", href: "/dashboard/trends", icon: TrendingUp },
  { key: "add", label: "Add", href: "/", icon: PlusCircle },
  { key: "receipts", label: "List", href: "/receipts", icon: List },
  { key: "calendar", label: "Calendar", href: "/receipts/calendar", icon: CalendarDays },
  { key: "wiki", label: "Wiki", href: "/wiki", icon: BookOpen },
  { key: "parser", label: "Parser", href: "/email-parser", icon: Mail },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      data-mobile-nav="true"
      className="fixed inset-x-0 bottom-0 z-[2147483647] border-t border-zinc-200 bg-white/95 px-1.5 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-[0_-8px_24px_rgba(24,24,27,0.08)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <div className="grid grid-cols-4 gap-0.5">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              data-mobile-nav-link={item.key}
              aria-current={active ? "page" : undefined}
              className={`grid min-h-14 min-w-0 justify-items-center gap-0.5 rounded-md px-0.5 py-1 text-[10px] font-medium leading-tight ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
