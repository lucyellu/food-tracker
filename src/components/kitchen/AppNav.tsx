"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Plus, ReceiptText, Settings, Refrigerator } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Kitchen", icon: Home },
  { href: "/pantry", label: "Pantry", icon: Refrigerator },
  { href: "/add", label: "Add", icon: Plus },
  { href: "/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/food/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      <header className="w-full max-w-6xl mx-auto px-4 pt-5 sm:px-8 sm:pt-7 flex items-baseline justify-between">
        <Link href="/" className="font-display text-xl tracking-tight italic">
          food tracker
        </Link>
        <nav className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className="label-caps text-ink-faint hover:text-ink aria-[current=page]:text-ink transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <nav
        aria-label="Primary"
        className="md:hidden fixed inset-x-4 bottom-4 z-40 flex items-center justify-around rounded-full bg-ink text-paper px-2 py-2 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.45)]"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 transition-colors ${
                active ? "bg-paper text-ink" : "text-paper/70"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {active && <span className="text-xs font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
