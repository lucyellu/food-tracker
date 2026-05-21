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
          <nav className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-6">
            <Link href="/" className="font-semibold text-lg">
              Food Tracker
            </Link>
            <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Add receipt
              </Link>
              <Link href="/receipts" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                All receipts
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
