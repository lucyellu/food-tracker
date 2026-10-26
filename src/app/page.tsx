import Link from "next/link";
import type { CSSProperties } from "react";
import { SectionHeader } from "@/components/kitchen/SectionHeader";
import { FoodEmoji, FoodTile } from "@/components/kitchen/FoodTile";
import { pantrySnapshot } from "@/lib/pantry/model";
import { getFoodHistories, getLastReceiptDate, getRecentHauls, type RecentHaul } from "@/lib/pantry/queries";
import { formatDuration, longDate, money, shortDate, tintVar } from "@/lib/pantry/format";
import { getToday, resolveAsOf } from "@/lib/pantry/today";

export const dynamic = "force-dynamic";

function StatTile({
  value,
  label,
  note,
  tint,
}: {
  value: string | number;
  label: string;
  note?: string;
  tint: string;
}) {
  return (
    <div
      className="flex min-h-36 flex-col justify-between rounded-[1.6rem] p-5"
      style={{ background: tintVar(tint), color: "var(--on-tint)" }}
    >
      <div className="label-mono opacity-70">{label}</div>
      <div>
        <div className="font-display text-5xl leading-none tracking-tight">{value}</div>
        {note && <div className="mt-2 text-sm opacity-70">{note}</div>}
      </div>
    </div>
  );
}

function HaulRow({ haul }: { haul: RecentHaul }) {
  const seen = new Set<string>();
  const stickers = haul.items.filter((item) => {
    if (!item.slug || item.kind === "non_food") return false;
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
  const shown = stickers.slice(0, 12);

  return (
    <Link
      href={`/receipts/${haul.receiptId}`}
      className="group grid gap-3 border-t border-line py-5 sm:grid-cols-[12rem_1fr] sm:gap-6"
    >
      <div>
        <div className="font-display text-xl leading-tight group-hover:underline underline-offset-4 decoration-1">
          {haul.vendor ?? "Receipt"}
        </div>
        <div className="label-mono mt-1 text-ink-faint">
          {haul.date ? shortDate(haul.date) : "—"} · {haul.items.length} items {money(haul.total) && `· ${money(haul.total)}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((item) => (
          <span
            key={item.slug}
            title={item.name}
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: tintVar(item.kind ?? "non_food") } as CSSProperties}
          >
            <FoodEmoji emoji={item.emoji} name={item.name} imageUrl={item.imageUrl} className="text-2xl" />
          </span>
        ))}
        {stickers.length > shown.length && (
          <span className="label-mono text-ink-faint">+{stickers.length - shown.length}</span>
        )}
        {stickers.length === 0 && <span className="label-mono text-ink-faint">No groceries</span>}
      </div>
    </Link>
  );
}

export default async function KitchenPage() {
  const [histories, lastReceipt, hauls, today] = await Promise.all([
    getFoodHistories(),
    getLastReceiptDate(),
    getRecentHauls(5),
    getToday(),
  ]);
  const { asOf, stale, staleDays } = resolveAsOf(today, lastReceipt);
  const snapshot = pantrySnapshot(histories, asOf);
  const fridge = snapshot.zones.find((z) => z.key === "fridge")?.entries ?? [];
  const lastHaul = hauls[0];

  return (
    <div className="space-y-14">
      <section className="pt-6 sm:pt-10">
        <div className="label-mono text-ink-faint">{longDate(today)}</div>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl">
          Your kitchen
        </h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          {snapshot.inStock > 0
            ? `${snapshot.inStock} things on hand, estimated from what you bought and how long each usually lasts you.`
            : "Nothing tracked yet. Receipts from your inbox fill this in on their own."}
        </p>
      </section>

      {stale && lastReceipt && (
        <section
          className="flex flex-col gap-3 rounded-[1.6rem] p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ background: tintVar("snack"), color: "var(--on-tint)" }}
        >
          <p className="text-sm">
            <span className="font-medium">No receipts for {formatDuration(staleDays)}.</span>{" "}
            Showing your kitchen as it was on {shortDate(lastReceipt)}, your last receipt.
          </p>
          <Link href="/settings" className="label-mono shrink-0 underline underline-offset-4">
            Reconnect inbox
          </Link>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatTile value={snapshot.inStock} label="On hand" note="foods in stock" tint="produce" />
        <StatTile
          value={snapshot.runningLow.length}
          label="Running low"
          note="due for a rebuy"
          tint="condiment"
        />
        <div className="col-span-2 sm:col-span-1">
          <StatTile
            value={lastHaul?.date ? shortDate(lastHaul.date) : "—"}
            label="Last haul"
            note={lastHaul?.vendor ?? undefined}
            tint="drink"
          />
        </div>
      </section>

      {snapshot.runningLow.length > 0 && (
        <section>
          <SectionHeader title="Running low" note="Based on how often you usually rebuy" />
          <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {snapshot.runningLow.slice(0, 10).map((entry) => (
              <div key={entry.food.id} className="w-28 shrink-0 sm:w-32">
                <FoodTile
                  entry={entry}
                  size="sm"
                  caption={`every ~${formatDuration(entry.lifetime.medianGapDays ?? entry.lifetime.days)}`}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {fridge.length > 0 && (
        <section>
          <SectionHeader
            title="In the fridge"
            note="Fullest first"
            action={{ href: "/pantry", label: "Whole pantry" }}
          />
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6">
            {fridge.slice(0, 12).map((entry) => (
              <FoodTile key={entry.food.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {hauls.length > 0 && (
        <section>
          <SectionHeader
            title="Recent hauls"
            action={{ href: "/receipts", label: "All receipts" }}
          />
          <div className="border-b border-line">
            {hauls.map((haul) => (
              <HaulRow key={haul.receiptId} haul={haul} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
