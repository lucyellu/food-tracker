import type { Metadata } from "next";
import { FoodTile } from "@/components/kitchen/FoodTile";
import { SectionHeader } from "@/components/kitchen/SectionHeader";
import { pantrySnapshot } from "@/lib/pantry/model";
import { getFoodHistories, getLastReceiptDate } from "@/lib/pantry/queries";
import { shortDate } from "@/lib/pantry/format";
import { getToday, resolveAsOf } from "@/lib/pantry/today";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pantry · Food Tracker" };

export default async function PantryPage() {
  const [histories, lastReceipt, today] = await Promise.all([
    getFoodHistories(),
    getLastReceiptDate(),
    getToday(),
  ]);
  const { asOf, stale } = resolveAsOf(today, lastReceipt);
  const snapshot = pantrySnapshot(histories, asOf);

  return (
    <div className="space-y-14">
      <section className="pt-6 sm:pt-10">
        <div className="label-mono text-ink-faint">
          {stale ? `As of ${shortDate(asOf)}, your last receipt` : "Right now"}
        </div>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-tight sm:text-7xl">Pantry</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Each tile empties as the food gets used up. Sauces and staples learn their pace from how
          often you rebuy them.
        </p>
      </section>

      {snapshot.zones.map((zone) =>
        zone.entries.length === 0 ? null : (
          <section key={zone.key}>
            <SectionHeader title={zone.label} note={`${zone.entries.length} · ${zone.note}`} />
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6">
              {zone.entries.map((entry) => (
                <FoodTile key={entry.food.id} entry={entry} />
              ))}
            </div>
          </section>
        ),
      )}

      {snapshot.inStock === 0 && (
        <p className="text-ink-soft">
          Nothing on hand. New receipts from your inbox will stock this automatically.
        </p>
      )}
    </div>
  );
}
