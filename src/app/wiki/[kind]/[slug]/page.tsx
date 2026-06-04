import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ReceiptText } from "lucide-react";
import { getWikiEntry, isWikiKind, wikiKindLabel, formatWikiMoney, formatWikiNumber, type WikiNutrition } from "@/lib/wiki";
import { NutritionFactsLabel } from "../../NutritionFactsLabel";
import { WikiBookmarkButton, WikiPageVisit } from "../../WikiMemory";

export const dynamic = "force-dynamic";

type WikiDetailProps = {
  params: Promise<{ kind: string; slug: string }>;
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function nutritionHighlights(nutrition: WikiNutrition) {
  return [
    nutrition.calories && nutrition.calories > 0 ? `${formatWikiNumber(nutrition.calories)} calories` : null,
    nutrition.proteinG && nutrition.proteinG > 0 ? `${formatWikiNumber(nutrition.proteinG, "g")} protein` : null,
    nutrition.carbsG && nutrition.carbsG > 0 ? `${formatWikiNumber(nutrition.carbsG, "g")} carbs` : null,
    nutrition.fatG && nutrition.fatG > 0 ? `${formatWikiNumber(nutrition.fatG, "g")} fat` : null,
    nutrition.caffeineMg && nutrition.caffeineMg > 0 ? `${formatWikiNumber(nutrition.caffeineMg, "mg")} caffeine` : null,
    nutrition.thcMg && nutrition.thcMg > 0 ? `${formatWikiNumber(nutrition.thcMg, "mg")} THC` : null,
  ].filter(Boolean);
}

export async function generateMetadata({ params }: WikiDetailProps): Promise<Metadata> {
  const { kind, slug } = await params;
  if (!isWikiKind(kind)) return { title: "Eatpedia" };
  const entry = await getWikiEntry(kind, slug);
  if (!entry) return { title: "Eatpedia" };
  return {
    title: `${entry.title} · Eatpedia`,
    description: entry.summary || `${wikiKindLabel(entry.kind)} page generated from your receipt history.`,
  };
}

export default async function WikiDetailPage({ params }: WikiDetailProps) {
  const { kind, slug } = await params;
  if (!isWikiKind(kind)) notFound();

  const entry = await getWikiEntry(kind, slug);
  if (!entry) notFound();

  const highlights = nutritionHighlights(entry.nutrition);
  const memoryItem = {
    href: entry.href,
    title: entry.title,
    kind: entry.kind,
    subtitle: entry.subtitle,
  };

  return (
    <div className="space-y-5">
      <WikiPageVisit item={memoryItem} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/wiki" className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="size-4" />
          Eatpedia
        </Link>
        <WikiBookmarkButton item={memoryItem} />
      </div>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {entry.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.imageUrl}
                  alt=""
                  className="h-36 w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800 sm:w-36"
                />
              ) : (
                <div className="grid h-36 w-full place-items-center rounded-lg bg-zinc-100 text-3xl font-semibold text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 sm:w-36">
                  {entry.title.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {wikiKindLabel(entry.kind)}
                  </span>
                  <span className="text-sm text-zinc-500">{entry.count} observed items</span>
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-normal">{entry.title}</h1>
                <p className="mt-2 text-sm text-zinc-500">{entry.subtitle}</p>
                {entry.summary ? (
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{entry.summary}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs font-medium uppercase text-zinc-500">Observed</div>
              <div className="mt-2 text-2xl font-semibold">{entry.count}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs font-medium uppercase text-zinc-500">Spend seen</div>
              <div className="mt-2 text-2xl font-semibold">{formatWikiMoney(entry.totalSpend)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs font-medium uppercase text-zinc-500">Latest</div>
              <div className="mt-2 text-2xl font-semibold">{formatDate(entry.latestDate)}</div>
            </div>
          </div>

          {highlights.length ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-semibold">Nutrition snapshot</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {highlights.map((highlight) => (
                  <span key={highlight} className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {highlight}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <ReceiptText className="size-4" />
              Recent receipt examples
            </div>
            <div className="grid gap-2">
              {entry.occurrences.map((item) => (
                <Link
                  key={`${item.receiptId}-${item.rawName}`}
                  href={`/receipts/${item.receiptId}`}
                  className="grid gap-2 rounded-md border border-zinc-200 p-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.rawName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{item.vendor ?? "Unknown vendor"} · {formatDate(item.purchasedAt)}</div>
                  </div>
                  <div className="font-semibold">{item.price == null ? "No price" : formatWikiMoney(item.price)}</div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4">
          <NutritionFactsLabel
            title={entry.title}
            servingName={
              entry.kind === "nutrient"
                ? "Observed items containing this nutrient"
                : `Typical observed ${wikiKindLabel(entry.kind).toLowerCase()} line`
            }
            nutrition={entry.nutrition}
          />

          {entry.related.length ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-semibold">Related pages</h2>
              <div className="mt-3 grid gap-2">
                {entry.related.map((related) => (
                  <Link
                    key={related.href}
                    href={related.href}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-xs uppercase text-zinc-400">{related.kind}</span>{" "}
                      <span className="font-medium">{related.title}</span>
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-zinc-400" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
