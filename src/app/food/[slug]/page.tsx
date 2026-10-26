import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { FoodEmoji } from "@/components/kitchen/FoodTile";
import { FinishButton } from "@/components/kitchen/FinishButton";
import { daysBetween, pantryEntry, type FoodHistory, type PantryEntry } from "@/lib/pantry/model";
import { getFoodHistory, getLastReceiptDate } from "@/lib/pantry/queries";
import { formatDuration, leftLabel, money, shortDate, tintVar, yearDate } from "@/lib/pantry/format";
import { getToday, resolveAsOf } from "@/lib/pantry/today";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const history = await getFoodHistory(slug);
  return { title: history ? `${history.food.name} · Food Tracker` : "Food Tracker" };
}

function explainLifetime(entry: PantryEntry) {
  const { lifetime, food, buyCount } = entry;
  const times = buyCount === 1 ? "once" : `${buyCount} times`;
  if (lifetime.basis === "learned" && lifetime.medianGapDays != null) {
    const gap = formatDuration(lifetime.medianGapDays);
    if (lifetime.days < lifetime.medianGapDays) {
      return `You've bought ${food.name.toLowerCase()} ${times} and usually rebuy every ${gap}, but it keeps about ${formatDuration(food.shelfLifeDays)}, so each purchase is counted as eaten within ${formatDuration(lifetime.days)}.`;
    }
    return `You've bought ${food.name.toLowerCase()} ${times} and usually rebuy every ${gap}, so that's how long one lasts you.`;
  }
  return `You've bought ${food.name.toLowerCase()} ${times}. Until there are a few more rebuys to learn from, it's assumed to last about ${formatDuration(lifetime.days)}, typical for one person.`;
}

function PurchaseTimeline({ history, asOf }: { history: FoodHistory; asOf: string }) {
  const dates = [...new Set(history.purchases.map((p) => p.date))].filter((d) => d <= asOf);
  if (dates.length === 0) return null;
  const start = `${dates[0].slice(0, 4)}-01-01`;
  const span = Math.max(1, daysBetween(start, asOf));
  const x = (date: string) => (daysBetween(start, date) / span) * 100;
  const years: string[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(asOf.slice(0, 4)); y++) years.push(String(y));

  return (
    <div>
      <div className="relative h-16">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {years.map((y) => (
          <div key={y} className="absolute top-0 h-full" style={{ left: `${x(`${y}-01-01`)}%` }}>
            <div className="h-full w-px bg-line" />
          </div>
        ))}
        {dates.map((d) => (
          <div
            key={d}
            title={shortDate(d)}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
            style={{ left: `${x(d)}%` }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4">
        {years.map((y) => (
          <span key={y} className="label-mono absolute text-ink-faint" style={{ left: `${x(`${y}-01-01`)}%` }}>
            {y}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function FoodPage({ params }: Props) {
  const { slug } = await params;
  const [history, lastReceipt, today] = await Promise.all([
    getFoodHistory(slug),
    getLastReceiptDate(),
    getToday(),
  ]);
  if (!history) notFound();

  const { asOf } = resolveAsOf(today, lastReceipt);
  const entry = pantryEntry(history, asOf);
  if (!entry) notFound();

  const { food } = entry;
  const style = { "--tint": tintVar(food.kind), "--level": entry.remaining } as CSSProperties;

  const productCounts = new Map<string, number>();
  for (const p of history.purchases) productCounts.set(p.productName, (productCounts.get(p.productName) ?? 0) + 1);
  const products = [...productCounts.entries()].sort((a, b) => b[1] - a[1]);
  const recent = [...history.purchases].reverse().slice(0, 30);

  return (
    <div className="space-y-14">
      <Link href="/pantry" className="label-mono inline-flex items-center gap-1.5 pt-4 text-ink-soft hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Pantry
      </Link>

      <section className="grid gap-8 md:grid-cols-[minmax(0,26rem)_1fr] md:items-end">
        <div style={style} className="food-level flex aspect-[4/5] items-center justify-center rounded-[2rem]">
          <FoodEmoji emoji={food.emoji} name={food.name} imageUrl={food.imageUrl} className="text-[9rem] sm:text-[11rem]" />
        </div>
        <div>
          <div className="label-mono text-ink-faint">
            N°{String(food.id).padStart(3, "0")} — {food.kind.replace("_", " ")}
          </div>
          <h1 className="mt-3 font-display text-6xl leading-[0.9] tracking-tight sm:text-8xl">{food.name}</h1>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-5">
            <div>
              <dt className="label-mono text-ink-faint">Left</dt>
              <dd className="mt-1 font-display text-3xl">{Math.round(entry.remaining * 100)}%</dd>
              <dd className="label-mono text-ink-faint">{leftLabel(entry)}</dd>
            </div>
            <div>
              <dt className="label-mono text-ink-faint">Lasts you</dt>
              <dd className="mt-1 font-display text-3xl">~{formatDuration(entry.lifetime.days)}</dd>
              <dd className="label-mono text-ink-faint">
                {entry.lifetime.basis === "learned" ? "learned" : "typical"}
              </dd>
            </div>
            <div>
              <dt className="label-mono text-ink-faint">Bought</dt>
              <dd className="mt-1 font-display text-3xl">{entry.buyCount}×</dd>
              <dd className="label-mono text-ink-faint">last {shortDate(entry.lastBought)}</dd>
            </div>
          </dl>
          <p className="mt-6 max-w-lg text-ink-soft">{explainLifetime(entry)}</p>
          <div className="mt-6">
            <FinishButton slug={food.slug} finished={Boolean(entry.finishedAt)} variant="text" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl tracking-tight sm:text-3xl">Every time you bought it</h2>
        <div className="mt-6">
          <PurchaseTimeline history={history} asOf={asOf} />
        </div>
      </section>

      <section className="grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="label-caps text-ink-soft">On receipts as</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {products.map(([name, count]) => (
              <li key={name} className="flex items-baseline justify-between gap-4 py-3">
                <span>{name}</span>
                <span className="label-mono shrink-0 text-ink-faint">{count}×</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="label-caps text-ink-soft">Recent purchases</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {recent.map((p) => (
              <li key={p.lineItemId}>
                <Link
                  href={`/receipts/${p.receiptId}`}
                  className="flex items-baseline justify-between gap-4 py-3 hover:text-ink-soft"
                >
                  <span>
                    {yearDate(p.date)}
                    <span className="text-ink-faint"> · {p.vendor ?? "Receipt"}</span>
                  </span>
                  <span className="label-mono shrink-0 text-ink-faint">{money(p.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
