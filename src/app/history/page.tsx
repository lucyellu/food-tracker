import type { Metadata } from "next";
import { FoodTile } from "@/components/kitchen/FoodTile";
import { SectionHeader } from "@/components/kitchen/SectionHeader";
import { ON_HAND_WINDOW_DAYS, pantryEntry, zoneForKind, type PantryEntry } from "@/lib/pantry/model";
import { getFoodHistories, getLastReceiptDate } from "@/lib/pantry/queries";
import { shortDate, yearDate } from "@/lib/pantry/format";
import { getToday, resolveAsOf } from "@/lib/pantry/today";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Past items · Food Tracker" };

export default async function HistoryPage() {
  const [histories, lastReceipt, today] = await Promise.all([
    getFoodHistories(),
    getLastReceiptDate(),
    getToday(),
  ]);
  const { asOf } = resolveAsOf(today, lastReceipt);

  const entries = histories
    .map((h) => pantryEntry(h, asOf))
    .filter((e): e is PantryEntry => e !== null && zoneForKind(e.food.kind) !== null);
  const onHand = (e: PantryEntry) => e.remaining > 0 && e.daysSince <= ON_HAND_WINDOW_DAYS;
  const past = entries.filter((e) => !onHand(e)).sort((a, b) => b.lastBought.localeCompare(a.lastBought));
  const marked = past.filter((e) => e.finishedAt);
  const earlier = past.filter((e) => !e.finishedAt);

  const caption = (e: PantryEntry) => `bought ${shortDate(e.lastBought)} · ${e.buyCount}×`;

  return (
    <div className="space-y-14">
      <section className="pt-6 sm:pt-10">
        <div className="label-mono text-ink-faint">Everything you have finished</div>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl">Past items</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Foods you marked as used up, and foods that have aged out of the pantry. Tap the arrow on a tile to put it
          back; buying it again restocks it on its own.
        </p>
      </section>

      {marked.length > 0 && (
        <section>
          <SectionHeader title="Marked used up" note={`${marked.length} · you finished these`} />
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6">
            {marked.map((entry) => (
              <FoodTile key={entry.food.id} entry={entry} action="restore" caption={`used up ${shortDate(entry.finishedAt!)}`} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Earlier" note={`${earlier.length} · most recent first`} />
        {earlier.length === 0 ? (
          <p className="text-ink-soft">Nothing yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6">
            {earlier.map((entry) => (
              <FoodTile key={entry.food.id} entry={entry} caption={`${caption(entry)}`} />
            ))}
          </div>
        )}
        {earlier.length > 0 && (
          <p className="label-mono mt-6 text-ink-faint">Oldest shown: {yearDate(earlier[earlier.length - 1].lastBought)}</p>
        )}
      </section>
    </div>
  );
}
