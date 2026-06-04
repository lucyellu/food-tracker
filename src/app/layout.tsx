import type { Metadata } from "next";
import Link from "next/link";
import { MobileNav } from "@/components/MobileNav";
import { TimezoneCookieSync } from "@/components/TimezoneCookieSync";
import "./globals.css";

export const metadata: Metadata = {
  title: "Food Tracker",
  description: "Parse grocery receipts and track nutrition",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full overflow-x-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
        <TimezoneCookieSync />
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <nav className="mx-auto flex max-w-[1800px] items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
            <Link href="/dashboard" className="font-semibold text-lg">
              Food Tracker
            </Link>
            <div className="hidden min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-600 md:flex dark:text-zinc-400">
              <Link href="/dashboard" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Dashboard
              </Link>
              <Link href="/dashboard/trends" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Trends
              </Link>
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Add receipt
              </Link>
              <Link href="/receipts" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                All receipts
              </Link>
              <Link href="/receipts/calendar" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Calendar
              </Link>
              <Link href="/wiki" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Eatpedia
              </Link>
              <Link href="/email-parser" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Email parser
              </Link>
              <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Settings
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1 max-w-[1800px] w-full mx-auto px-3 py-4 pb-28 sm:px-6 sm:py-8 md:pb-8">{children}</main>
        <MobileNav />
      </body>
    </html>
  );
}
