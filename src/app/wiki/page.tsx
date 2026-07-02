import Link from "next/link";
import { BookOpen, Search, Sparkles } from "lucide-react";
import { getWikiIndex, isWikiKind, sortWikiEntries, WIKI_KINDS, wikiKindPlural, type WikiIndexEntry, type WikiKind } from "@/lib/wiki";
import { WikiMemoryPanel } from "./WikiMemory";

export const dynamic = "force-dynamic";

function parseKind(value: string | string[] | undefined): WikiKind | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && isWikiKind(raw) ? raw : "all";
}

function parseQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, 80);
}

function kindHref(kind: WikiKind | "all", q: string) {
  const params = new URLSearchParams();
  if (kind !== "all") params.set("kind", kind);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/wiki?${query}` : "/wiki";
}

function EntryCard({ entry }: { entry: WikiIndexEntry }) {
  return (
    <Link
      href={entry.href}
      className="group block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <div className="flex items-start gap-3">
        {entry.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.imageUrl}
            alt=""
            className="size-14 shrink-0 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
          />
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-md bg-zinc-100 text-sm font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
            {entry.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {entry.kind}
            </span>
            <span className="text-xs text-zinc-400">{entry.count} seen</span>
          </div>
          <div className="mt-2 truncate text-base font-semibold group-hover:underline">{entry.title}</div>
          <div className="mt-1 truncate text-sm text-zinc-500">{entry.subtitle}</div>
          <div className="mt-3 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{entry.summary || "Observed in your receipt library."}</div>
        </div>
      </div>
    </Link>
  );
}

export default async function WikiPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const activeKind = parseKind(params.kind);
  const q = parseQuery(params.q);
  const qLower = q.toLowerCase();
  const index = await getWikiIndex();
  const filtered = sortWikiEntries(index.entries).filter((entry) => {
    if (activeKind !== "all" && entry.kind !== activeKind) return false;
    if (!qLower) return true;
    return `${entry.title} ${entry.subtitle} ${entry.summary} ${entry.kind}`.toLowerCase().includes(qLower);
  });
  const featured = filtered.slice(0, 36);
  const topProducts = sortWikiEntries(index.entries.filter((entry) => entry.kind === "product")).slice(0, 8);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
            <BookOpen className="size-4" />
            Eatpedia
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">Your personal food wiki</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Browse products, brands, ingredients, nutrients, and categories generated from your own receipt history.
          </p>

          <form action="/wiki" className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            {activeKind !== "all" ? <input type="hidden" name="kind" value={activeKind} /> : null}
            <label className="sr-only" htmlFor="wiki-search">Search Eatpedia</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                id="wiki-search"
                name="q"
                defaultValue={q}
                placeholder="Search products, ingredients, nutrients..."
                className="h-11 w-full rounded-md border border-zinc-200 bg-transparent px-3 pl-9 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800"
              />
            </div>
            <button className="h-11 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
              Search
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={kindHref("all", q)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                activeKind === "all"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              All
            </Link>
            {WIKI_KINDS.map((kind) => (
              <Link
                key={kind.key}
                href={kindHref(kind.key, q)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  activeKind === kind.key
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {kind.plural} <span className="text-xs opacity-70">{index.counts[kind.key]}</span>
              </Link>
            ))}
          </div>
        </div>

        <WikiMemoryPanel />
      </section>

      {!q && activeKind === "all" && topProducts.length ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" />
            Most-seen products
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {topProducts.map((entry) => <EntryCard key={entry.href} entry={entry} />)}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">
              {activeKind === "all" ? "All entries" : wikiKindPlural(activeKind)}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {filtered.length} matching {filtered.length === 1 ? "page" : "pages"}
            </p>
          </div>
        </div>

        {featured.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((entry) => <EntryCard key={entry.href} entry={entry} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            No matching wiki pages yet.
          </div>
        )}
      </section>
    </div>
  );
}
