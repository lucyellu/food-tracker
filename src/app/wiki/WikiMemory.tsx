"use client";

import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Bookmark, Clock, Star } from "lucide-react";
import type { WikiKind } from "@/lib/wiki";

type WikiMemoryItem = {
  href: string;
  title: string;
  kind: WikiKind;
  subtitle: string;
  viewedAt: number;
};

const HISTORY_KEY = "food-tracker:wiki-history";
const BOOKMARKS_KEY = "food-tracker:wiki-bookmarks";
const MAX_ITEMS = 24;

function readItems(key: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WikiMemoryItem =>
      item &&
      typeof item.href === "string" &&
      typeof item.title === "string" &&
      typeof item.kind === "string" &&
      typeof item.subtitle === "string" &&
      typeof item.viewedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeItems(key: string, items: WikiMemoryItem[]) {
  window.localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

function subscribeMemory(callback: () => void) {
  window.addEventListener("food-tracker:wiki-memory", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("food-tracker:wiki-memory", callback);
    window.removeEventListener("storage", callback);
  };
}

function getItemsSnapshot(key: string) {
  return JSON.stringify(readItems(key));
}

function useStoredItems(key: string) {
  const snapshot = useSyncExternalStore(
    subscribeMemory,
    () => getItemsSnapshot(key),
    () => "[]",
  );
  return useMemo(() => {
    try {
      return JSON.parse(snapshot) as WikiMemoryItem[];
    } catch {
      return [];
    }
  }, [snapshot]);
}

function upsert(items: WikiMemoryItem[], item: WikiMemoryItem) {
  return [item, ...items.filter((existing) => existing.href !== item.href)].slice(0, MAX_ITEMS);
}

function kindLabel(kind: WikiKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function WikiPageVisit({ item }: { item: Omit<WikiMemoryItem, "viewedAt"> }) {
  const { href, kind, subtitle, title } = item;

  useEffect(() => {
    const viewedAt = Date.now();
    writeItems(HISTORY_KEY, upsert(readItems(HISTORY_KEY), { href, kind, subtitle, title, viewedAt }));
    window.dispatchEvent(new Event("food-tracker:wiki-memory"));
  }, [href, kind, subtitle, title]);

  return null;
}

export function WikiBookmarkButton({ item }: { item: Omit<WikiMemoryItem, "viewedAt"> }) {
  const bookmarks = useStoredItems(BOOKMARKS_KEY);
  const bookmarked = bookmarks.some((bookmark) => bookmark.href === item.href);

  function toggleBookmark() {
    const bookmarks = readItems(BOOKMARKS_KEY);
    if (bookmarks.some((bookmark) => bookmark.href === item.href)) {
      writeItems(BOOKMARKS_KEY, bookmarks.filter((bookmark) => bookmark.href !== item.href));
    } else {
      writeItems(BOOKMARKS_KEY, upsert(bookmarks, { ...item, viewedAt: Date.now() }));
    }
    window.dispatchEvent(new Event("food-tracker:wiki-memory"));
  }

  return (
    <button
      type="button"
      onClick={toggleBookmark}
      className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
        bookmarked
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      }`}
    >
      <Bookmark className="size-4" />
      {bookmarked ? "Bookmarked" : "Bookmark"}
    </button>
  );
}

function MemoryList({ items, empty }: { items: WikiMemoryItem[]; empty: string }) {
  if (!items.length) {
    return <div className="rounded-md border border-dashed border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800">{empty}</div>;
  }

  return (
    <div className="grid gap-2">
      {items.slice(0, 6).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="block rounded-md border border-zinc-200 bg-white p-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-zinc-500">{kindLabel(item.kind)} · {item.subtitle}</div>
            </div>
            <span className="shrink-0 text-xs text-zinc-400">
              {new Date(item.viewedAt).toLocaleDateString()}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function WikiMemoryPanel() {
  const history = useStoredItems(HISTORY_KEY);
  const bookmarks = useStoredItems(BOOKMARKS_KEY);

  const sections = useMemo(
    () => [
      {
        key: "bookmarks",
        title: "Bookmarks",
        icon: <Star className="size-4" />,
        items: bookmarks,
        empty: "Bookmark wiki pages to pin your usual foods here.",
      },
      {
        key: "history",
        title: "Recently viewed",
        icon: <Clock className="size-4" />,
        items: history,
        empty: "Open product, brand, ingredient, or nutrient pages to build history.",
      },
    ],
    [bookmarks, history],
  );

  return (
    <div className="grid gap-3">
      {sections.map((section) => (
        <section key={section.key} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            {section.icon}
            {section.title}
          </div>
          <MemoryList items={section.items} empty={section.empty} />
        </section>
      ))}
    </div>
  );
}
