import type { Metadata } from "next";
import Link from "next/link";
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
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <nav className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
            <Link href="/" className="font-semibold text-lg">
              Food Tracker
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Add receipt
              </Link>
              <Link href="/receipts" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                All receipts
              </Link>
              <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Settings
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1 max-w-[1800px] w-full mx-auto px-3 py-4 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
