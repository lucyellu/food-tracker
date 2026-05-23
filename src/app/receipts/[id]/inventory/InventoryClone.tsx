"use client";

import Link from "next/link";
import {
  type MouseEvent,
  useMemo,
  useState,
} from "react";
import type {
  ReceiptConsumptionLog,
  ReceiptTrackerItem,
} from "../ReceiptNutritionTracker";

type ConsumptionStatus = ReceiptTrackerItem["consumptionStatus"];
type ShelfKind = "available" | "pantry" | "fridge" | "consumed" | "disposed";

export type InventoryReceipt = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
};

type NutritionMeta = {
  basis?: string;
  entryType?: string;
  serving?: { estimatedServings?: number | null };
};

type StackInfo = {
  total: number;
  left: number;
  consumed: number;
  unitLabel: string;
  clickLabel: string;
  gramsPerServing: number | null;
};

const SHELF_META: Record<
  ShelfKind,
  {
    title: string;
    empty: string;
    className: string;
    railClassName: string;
  }
> = {
  available: {
    title: "Counter",
    empty: "No loose items.",
    className: "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950",
    railClassName: "from-zinc-300 to-zinc-500 dark:from-zinc-800 dark:to-zinc-950",
  },
  pantry: {
    title: "Pantry",
    empty: "Nothing on the shelf.",
    className: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20",
    railClassName: "from-amber-300 to-orange-500 dark:from-amber-900 dark:to-orange-950",
  },
  fridge: {
    title: "Fridge",
    empty: "The drawer is empty.",
    className: "border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/20",
    railClassName: "from-cyan-200 to-sky-500 dark:from-cyan-900 dark:to-sky-950",
  },
  consumed: {
    title: "Consumed",
    empty: "No servings logged.",
    className: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20",
    railClassName: "from-emerald-300 to-lime-500 dark:from-emerald-900 dark:to-lime-950",
  },
  disposed: {
    title: "Discarded",
    empty: "Nothing discarded.",
    className: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/20",
    railClassName: "from-rose-300 to-red-500 dark:from-rose-900 dark:to-red-950",
  },
};

const CATEGORY_EMOJI: Array<[RegExp, string]> = [
  [/apple|pear|peach|plum|orange|banana|melon|watermelon|fruit/i, "🍎"],
  [/egg/i, "🥚"],
  [/pork|beef|chicken|duck|rib|kidney|meat|tripe|bung|shank/i, "🥩"],
  [/fish|salmon|eel|basa|seafood|mussel|shrimp|dumpling/i, "🐟"],
  [/noodle|pho|rice|konjac|bread|crisp|base/i, "🍜"],
  [/cabbage|watercress|onion|eggplant|squash|melon|mushroom|radish|vegetable/i, "🥬"],
  [/tea|juice|drink|coconut|aloe|caffeine|coffee/i, "🥤"],
  [/ice|bar|frozen/i, "🍨"],
  [/walnut|nut/i, "🥜"],
  [/sauce|mirin|soy|seasoned|salted|spicy|kimchi|preserved/i, "🫙"],
];

const PRODUCE_GRAMS: Array<[RegExp, { grams: number; label: string }]> = [
  [/apple/i, { grams: 180, label: "apple" }],
  [/egg/i, { grams: 50, label: "egg" }],
  [/banana/i, { grams: 118, label: "banana" }],
  [/orange/i, { grams: 140, label: "orange" }],
  [/watermelon/i, { grams: 280, label: "slice" }],
  [/eggplant/i, { grams: 160, label: "eggplant" }],
  [/onion/i, { grams: 100, label: "onion" }],
];

function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function todayDateTimeInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function parseMeta(meta: string | null | undefined): NutritionMeta | null {
  if (!meta) return null;
  try {
    return JSON.parse(meta) as NutritionMeta;
  } catch {
    return null;
  }
}

function countFromName(name: string) {
  const pieces = name.match(/\b(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|ct|count)\b/i);
  if (pieces) return Number(pieces[1]);
  const pack = name.match(/\((\d+)\s*[xX]\s*[^)]*\)/);
  if (pack) return Number(pack[1]);
  return null;
}

function categoryEmoji(name: string) {
  return CATEGORY_EMOJI.find(([pattern]) => pattern.test(name))?.[1] ?? "🍽️";
}

function produceServing(name: string) {
  return PRODUCE_GRAMS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

function inferStack(item: ReceiptTrackerItem, logs: ReceiptConsumptionLog[]): StackInfo {
  const meta = parseMeta(item.nutrition?.activeIngredientsJson);
  const explicitServings = meta?.serving?.estimatedServings;
  const nameCount = countFromName(item.rawName);
  const produce = produceServing(item.rawName);
  const totalGrams = item.nutrition?.totalGrams ?? null;

  let total = explicitServings && explicitServings > 0 ? explicitServings : null;
  let unitLabel = "serving";
  let gramsPerServing: number | null = null;

  if (produce && totalGrams && totalGrams > 0) {
    total = Math.max(1, Math.round(totalGrams / produce.grams));
    unitLabel = produce.label;
    gramsPerServing = produce.grams;
  } else if (nameCount && nameCount > 0) {
    total = nameCount;
    unitLabel = /egg/i.test(item.rawName) ? "egg" : "piece";
    gramsPerServing = totalGrams && total > 0 ? totalGrams / total : null;
  } else if (total && total > 0) {
    gramsPerServing = totalGrams && total > 0 ? totalGrams / total : null;
  } else if (item.unit === "count" && item.quantity > 1) {
    total = item.quantity;
    unitLabel = "item";
    gramsPerServing = totalGrams && total > 0 ? totalGrams / total : null;
  } else {
    total = 1;
  }

  const consumed = logs.reduce((sum, log) => {
    if (log.lineItemId !== item.id) return sum;
    if (log.unit === "serving") return sum + log.amount;
    if (log.unit === "item") return sum + (total && item.quantity > 0 ? log.amount * (total / item.quantity) : log.amount);
    if (log.unit === "g") return sum + (gramsPerServing ? log.amount / gramsPerServing : log.amount / 100);
    if (log.unit === "100g") return sum + (gramsPerServing ? (log.amount * 100) / gramsPerServing : log.amount);
    return sum;
  }, 0);

  const roundedTotal = Math.max(1, Math.ceil(total));
  const roundedConsumed = Math.max(0, consumed);
  const left = Math.max(0, roundedTotal - roundedConsumed);
  return {
    total: roundedTotal,
    left,
    consumed: roundedConsumed,
    unitLabel,
    clickLabel: `1 ${unitLabel}`,
    gramsPerServing,
  };
}

function latestLogForItem(logs: ReceiptConsumptionLog[], itemId: number) {
  return [...logs]
    .filter((log) => log.lineItemId === itemId)
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt) || b.id - a.id)[0];
}

function groupLogsByDay(logs: ReceiptConsumptionLog[], itemsById: Map<number, ReceiptTrackerItem>) {
  const grouped = new Map<string, Array<{ log: ReceiptConsumptionLog; item: ReceiptTrackerItem | undefined }>>();
  for (const log of logs) {
    const day = log.consumedAt.slice(0, 10);
    const rows = grouped.get(day) ?? [];
    rows.push({ log, item: itemsById.get(log.lineItemId) });
    grouped.set(day, rows);
  }
  return [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function shelfForItem(item: ReceiptTrackerItem, stack: StackInfo): ShelfKind {
  if (item.consumptionStatus === "disposed") return "disposed";
  if (item.consumptionStatus === "consumed" || stack.left <= 0) return "consumed";
  if (item.consumptionStatus === "fridge") return "fridge";
  if (item.consumptionStatus === "pantry") return "pantry";
  return "available";
}

function compactName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function StackCard({
  item,
  stack,
  busy,
  onConsume,
  onUndo,
  onMove,
}: {
  item: ReceiptTrackerItem;
  stack: StackInfo;
  busy: boolean;
  onConsume: () => void;
  onUndo: () => void;
  onMove: (status: ConsumptionStatus) => void;
}) {
  const canConsume = stack.left > 0 && !["disposed", "refunded", "unavailable"].includes(item.consumptionStatus);
  const image = item.productImageUrl;
  const emoji = categoryEmoji(item.rawName);

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onUndo();
  }

  return (
    <article className="group relative min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <button
        type="button"
        onClick={onConsume}
        onContextMenu={handleContextMenu}
        disabled={busy || !canConsume}
        className="block w-full min-w-0 p-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
        title={`${compactName(item.rawName)} · ${stack.clickLabel}`}
      >
        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow dark:bg-zinc-100 dark:text-zinc-950">
          {formatNumber(stack.left, stack.left < 10 ? 1 : 0)}
        </span>
        <span className="relative grid aspect-square place-items-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-950">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
          ) : (
            <span className="text-4xl leading-none drop-shadow-sm">{emoji}</span>
          )}
        </span>
        <span className="mt-2 block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {compactName(item.rawName)}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
          {stack.clickLabel} · {formatNumber(stack.consumed, 1)} used
        </span>
      </button>
      <div className="grid grid-cols-3 border-t border-zinc-100 text-[10px] dark:border-zinc-800">
        <button
          type="button"
          onClick={() => onMove("pantry")}
          disabled={busy}
          className="px-1 py-1.5 text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          Pantry
        </button>
        <button
          type="button"
          onClick={() => onMove("fridge")}
          disabled={busy}
          className="border-x border-zinc-100 px-1 py-1.5 text-cyan-700 hover:bg-cyan-50 disabled:opacity-50 dark:border-zinc-800 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
        >
          Fridge
        </button>
        <button
          type="button"
          onClick={() => onMove("disposed")}
          disabled={busy}
          className="px-1 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          Toss
        </button>
      </div>
    </article>
  );
}

function Shelf({
  kind,
  items,
  stacks,
  busyId,
  onConsume,
  onUndo,
  onMove,
}: {
  kind: ShelfKind;
  items: ReceiptTrackerItem[];
  stacks: Map<number, StackInfo>;
  busyId: number | null;
  onConsume: (item: ReceiptTrackerItem) => void;
  onUndo: (item: ReceiptTrackerItem) => void;
  onMove: (item: ReceiptTrackerItem, status: ConsumptionStatus) => void;
}) {
  const meta = SHELF_META[kind];
  return (
    <section className={`overflow-hidden rounded-lg border ${meta.className}`}>
      <div className={`h-2 bg-gradient-to-r ${meta.railClassName}`} />
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-semibold">{meta.title}</h2>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-950/70 dark:text-zinc-300">
          {items.length}
        </span>
      </div>
      <div className="grid min-h-52 grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-4">
        {items.length === 0 ? (
          <div className="col-span-full grid min-h-32 place-items-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
            {meta.empty}
          </div>
        ) : (
          items.map((item) => {
            const stack = stacks.get(item.id);
            if (!stack) return null;
            return (
              <StackCard
                key={item.id}
                item={item}
                stack={stack}
                busy={busyId === item.id}
                onConsume={() => onConsume(item)}
                onUndo={() => onUndo(item)}
                onMove={(status) => onMove(item, status)}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

export function InventoryClone({
  receipt,
  initialItems,
  initialLogs,
}: {
  receipt: InventoryReceipt;
  initialItems: ReceiptTrackerItem[];
  initialLogs: ReceiptConsumptionLog[];
}) {
  const [items, setItems] = useState(initialItems);
  const [logs, setLogs] = useState(initialLogs);
  const [logAt, setLogAt] = useState(todayDateTimeInput());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const stacks = useMemo(() => {
    const next = new Map<number, StackInfo>();
    for (const item of items) next.set(item.id, inferStack(item, logs));
    return next;
  }, [items, logs]);
  const shelves = useMemo(() => {
    const next: Record<ShelfKind, ReceiptTrackerItem[]> = {
      available: [],
      pantry: [],
      fridge: [],
      consumed: [],
      disposed: [],
    };
    for (const item of items) {
      if (item.consumptionStatus === "refunded" || item.consumptionStatus === "unavailable") continue;
      const stack = stacks.get(item.id);
      if (!stack) continue;
      next[shelfForItem(item, stack)].push(item);
    }
    return next;
  }, [items, stacks]);
  const calendarRows = useMemo(() => groupLogsByDay(logs, itemsById), [logs, itemsById]);
  const totalLeft = useMemo(
    () => [...stacks.values()].reduce((sum, stack) => sum + stack.left, 0),
    [stacks],
  );

  async function setStatus(item: ReceiptTrackerItem, status: ConsumptionStatus) {
    setBusyId(item.id);
    setMessage(null);
    const statusDate = status === "consumed" || status === "disposed" ? logAt.slice(0, 10) : null;
    const previous = items;
    setItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, consumptionStatus: status, statusDate } : row)),
    );
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [item.id], status, statusDate }),
      });
      if (!res.ok) throw new Error("status update failed");
    } catch {
      setItems(previous);
      setMessage("Could not update that stack.");
    } finally {
      setBusyId(null);
    }
  }

  async function consumeOne(item: ReceiptTrackerItem) {
    const stack = stacks.get(item.id);
    if (!stack || stack.left <= 0) return;
    setBusyId(item.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/consumption`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineItemId: item.id,
          consumedAt: logAt,
          amount: 1,
          unit: "serving",
          note: stack.clickLabel,
        }),
      });
      if (!res.ok) throw new Error("consume failed");
      const data = (await res.json()) as { log: ReceiptConsumptionLog };
      setLogs((current) => [...current, data.log].sort((a, b) => a.consumedAt.localeCompare(b.consumedAt)));
      if (stack.left <= 1) {
        await setStatus(item, "consumed");
      }
    } catch {
      setMessage("Could not log that serving.");
    } finally {
      setBusyId(null);
    }
  }

  async function undoLatest(item: ReceiptTrackerItem) {
    const log = latestLogForItem(logs, item.id);
    if (!log) {
      if (item.consumptionStatus === "disposed") await setStatus(item, "available");
      return;
    }
    setBusyId(item.id);
    setMessage(null);
    const previousLogs = logs;
    setLogs((current) => current.filter((row) => row.id !== log.id));
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/consumption`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logId: log.id }),
      });
      if (!res.ok) throw new Error("undo failed");
      if (item.consumptionStatus === "consumed") {
        await setStatus(item, "available");
      }
    } catch {
      setLogs(previousLogs);
      setMessage("Could not undo that serving.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Inventory clone</div>
            <div className="mt-1 text-lg font-semibold">{formatNumber(totalLeft, 1)} servings left</div>
          </div>
          <label className="grid gap-1 text-xs text-zinc-500">
            Date and time
            <input
              type="datetime-local"
              value={logAt}
              onChange={(event) => setLogAt(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <Link
            href={`/receipts/${receipt.id}`}
            className="rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Table
          </Link>
        </div>

        {message ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Shelf
            kind="fridge"
            items={shelves.fridge}
            stacks={stacks}
            busyId={busyId}
            onConsume={consumeOne}
            onUndo={undoLatest}
            onMove={setStatus}
          />
          <Shelf
            kind="pantry"
            items={shelves.pantry}
            stacks={stacks}
            busyId={busyId}
            onConsume={consumeOne}
            onUndo={undoLatest}
            onMove={setStatus}
          />
        </div>

        <Shelf
          kind="available"
          items={shelves.available}
          stacks={stacks}
          busyId={busyId}
          onConsume={consumeOne}
          onUndo={undoLatest}
          onMove={setStatus}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Shelf
            kind="consumed"
            items={shelves.consumed}
            stacks={stacks}
            busyId={busyId}
            onConsume={consumeOne}
            onUndo={undoLatest}
            onMove={setStatus}
          />
          <Shelf
            kind="disposed"
            items={shelves.disposed}
            stacks={stacks}
            busyId={busyId}
            onConsume={consumeOne}
            onUndo={undoLatest}
            onMove={setStatus}
          />
        </div>
      </div>

      <aside className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Calendar log</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            {logs.length}
          </span>
        </div>
        <div className="mt-3 max-h-[72vh] space-y-3 overflow-y-auto pr-1">
          {calendarRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
              No servings logged.
            </div>
          ) : (
            calendarRows.map(([day, rows]) => (
              <section key={day} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="text-xs font-semibold text-zinc-500">{day}</div>
                <div className="mt-2 space-y-1.5">
                  {rows.map(({ log, item }) => (
                    <div key={log.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5" aria-hidden="true">
                        {categoryEmoji(item?.rawName ?? "")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item ? compactName(item.rawName) : "Unknown item"}</div>
                        <div className="text-zinc-500">
                          {log.consumedAt.slice(11, 16)} · {formatNumber(log.amount, 1)} {log.unit}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => item && undoLatest(item)}
                        disabled={!item || busyId === item.id}
                        className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Undo
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
