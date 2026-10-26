import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/kitchen/AppNav";
import { TimezoneCookieSync } from "@/components/TimezoneCookieSync";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "opsz"],
});
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Food Tracker",
  description: "A pantry that fills itself from your grocery receipts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-full overflow-x-hidden flex flex-col bg-paper text-ink font-sans">
        <TimezoneCookieSync />
        <AppNav />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 pt-4 pb-32 sm:px-8 sm:pt-8 md:pb-16">
          {children}
        </main>
      </body>
    </html>
  );
}
