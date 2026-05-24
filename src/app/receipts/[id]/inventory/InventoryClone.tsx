"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ReceiptConsumptionLog,
  ReceiptTrackerItem,
} from "../ReceiptNutritionTracker";

type ConsumptionStatus = ReceiptTrackerItem["consumptionStatus"];
type ShelfKind = "available" | "pantry" | "fridge" | "consumed" | "disposed";
type SortMode = "name" | "left" | "calories" | "carbs" | "protein" | "sodium" | "recent";
type InventoryFilter = "active" | "all" | "counter" | "stored" | "fridge" | "pantry" | "food" | "drink";
type ConsumeKind = "eaten" | "drank";

const SHELF_ORDER: ShelfKind[] = ["available", "fridge", "pantry", "consumed", "disposed"];

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

type SavedInventoryView = {
  filter?: InventoryFilter;
  sort?: SortMode;
  search?: string;
  collapsedShelves?: ShelfKind[];
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
    title: "Eaten / drank",
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

function isDrinkItem(item: ReceiptTrackerItem) {
  return /tea|juice|drink|coconut|aloe|coffee|milk|water|soda|beverage|latte|caffeine/i.test(
    `${item.rawName} ${item.unit}`,
  );
}

function autoStorageStatus(item: ReceiptTrackerItem): ConsumptionStatus {
  if (
    /fresh|frozen|egg|pork|beef|chicken|duck|fish|salmon|eel|basa|seafood|mussel|shrimp|meat|rib|kidney|tripe|bung|shank|cabbage|watercress|onion|eggplant|squash|melon|mushroom|apple|fruit/i.test(
      item.rawName,
    )
  ) {
    return "fridge";
  }
  return "pantry";
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

function logsForItem(logs: ReceiptConsumptionLog[], itemId: number) {
  return [...logs]
    .filter((log) => log.lineItemId === itemId)
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt) || b.id - a.id);
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

function nutrientValue(item: ReceiptTrackerItem, sort: SortMode) {
  if (sort === "calories") return item.nutrition?.calories ?? 0;
  if (sort === "carbs") return item.nutrition?.carbsG ?? 0;
  if (sort === "protein") return item.nutrition?.proteinG ?? 0;
  if (sort === "sodium") return item.nutrition?.sodiumMg ?? 0;
  return 0;
}

function latestItemLog(logs: ReceiptConsumptionLog[], itemId: number) {
  return logs
    .filter((log) => log.lineItemId === itemId)
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt) || b.id - a.id)[0];
}

function filterItem(item: ReceiptTrackerItem, stack: StackInfo | undefined, filter: InventoryFilter, search: string) {
  if (!stack) return false;
  const query = search.trim().toLowerCase();
  if (query && !`${item.rawName} ${item.normalizedName ?? ""}`.toLowerCase().includes(query)) return false;
  if (filter === "all") return true;
  if (filter === "active") return !["consumed", "disposed", "refunded", "unavailable"].includes(item.consumptionStatus) && stack.left > 0;
  if (filter === "counter") return shelfForItem(item, stack) === "available";
  if (filter === "stored") return item.consumptionStatus === "fridge" || item.consumptionStatus === "pantry";
  if (filter === "fridge") return item.consumptionStatus === "fridge";
  if (filter === "pantry") return item.consumptionStatus === "pantry";
  if (filter === "drink") return isDrinkItem(item);
  if (filter === "food") return !isDrinkItem(item);
  return true;
}

function sortItems(
  items: ReceiptTrackerItem[],
  stacks: Map<number, StackInfo>,
  logs: ReceiptConsumptionLog[],
  sort: SortMode,
) {
  return [...items].sort((a, b) => {
    if (sort === "name") return compactName(a.rawName).localeCompare(compactName(b.rawName));
    if (sort === "left") return (stacks.get(b.id)?.left ?? 0) - (stacks.get(a.id)?.left ?? 0);
    if (sort === "recent") {
      const aLog = latestItemLog(logs, a.id)?.consumedAt ?? a.statusDate ?? "";
      const bLog = latestItemLog(logs, b.id)?.consumedAt ?? b.statusDate ?? "";
      return bLog.localeCompare(aLog);
    }
    return nutrientValue(b, sort) - nutrientValue(a, sort);
  });
}

function amountLabel(amount: number, unitLabel: string) {
  return `${formatNumber(amount, amount < 10 ? 1 : 0)} ${unitLabel}${amount === 1 ? "" : "s"}`;
}

function StackCard({
  item,
  stack,
  busy,
  onConsume,
  onUndo,
  onRestore,
}: {
  item: ReceiptTrackerItem;
  stack: StackInfo;
  busy: boolean;
  onConsume: (kind: ConsumeKind, amount: number) => void;
  onUndo: (mode: "one" | "all") => void;
  onRestore: () => void;
}) {
  const canConsume = stack.left > 0 && !["disposed", "refunded", "unavailable"].includes(item.consumptionStatus);
  const isDisposed = item.consumptionStatus === "disposed";
  const isConsumed = item.consumptionStatus === "consumed" || stack.left <= 0;
  const hasConsumed = stack.consumed > 0;
  const image = item.productImageUrl;
  const emoji = categoryEmoji(item.rawName);
  const consumeKind: ConsumeKind = isDrinkItem(item) ? "drank" : "eaten";
  const consumeLabel = consumeKind === "drank" ? "Drink" : "Eat";
  const wholeLabel = consumeKind === "drank" ? "Drink all" : "Eat all";
  const nutrientSummary = [
    item.nutrition?.calories == null ? null : `${formatNumber(item.nutrition.calories)} cal`,
    item.nutrition?.carbsG == null ? null : `${formatNumber(item.nutrition.carbsG)}g C`,
  ].filter(Boolean);

  function handlePrimaryAction() {
    if (isDisposed) {
      onRestore();
      return;
    }
    if (isConsumed) {
      onUndo("one");
      return;
    }
    onConsume(consumeKind, 1);
  }

  return (
    <article className="group relative min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <div className="grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1.5 p-1.5 sm:grid-cols-[42px_minmax(0,1fr)]" title={`${compactName(item.rawName)} · ${stack.clickLabel}`}>
        <span className="absolute right-1 top-1 z-10 rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow dark:bg-zinc-100 dark:text-zinc-950">
          {formatNumber(stack.left, stack.left < 10 ? 1 : 0)}
        </span>
        <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-950 sm:h-11 sm:w-11">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="text-2xl leading-none drop-shadow-sm sm:text-3xl">{emoji}</span>
          )}
        </span>
        <span className="min-w-0 pt-0.5">
          <span className="block truncate text-[11px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
            {compactName(item.rawName)}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
            {stack.clickLabel} · {nutrientSummary.join(" · ") || "no totals"}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 border-t border-zinc-100 text-[10px] dark:border-zinc-800">
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={busy || (!canConsume && !isConsumed && !isDisposed)}
          className="px-1 py-1 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        >
          {isDisposed ? "Restore" : isConsumed ? "Undo 1" : `${consumeLabel} 1`}
        </button>
        <button
          type="button"
          onClick={() => onConsume(consumeKind, stack.left)}
          disabled={busy || !canConsume}
          className="border-l border-zinc-100 px-1 py-1 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-zinc-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        >
          {wholeLabel}
        </button>
        <button
          type="button"
          onClick={() => onUndo("one")}
          disabled={busy || !hasConsumed}
          className="border-t border-zinc-100 px-1 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Undo 1
        </button>
        <button
          type="button"
          onClick={() => onUndo("all")}
          disabled={busy || !hasConsumed}
          className="border-l border-t border-zinc-100 px-1 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Undo all
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
  collapsed,
  empty,
  onConsume,
  onUndo,
  onRestore,
  onToggle,
}: {
  kind: ShelfKind;
  items: ReceiptTrackerItem[];
  stacks: Map<number, StackInfo>;
  busyId: number | null;
  collapsed: boolean;
  empty: boolean;
  onConsume: (item: ReceiptTrackerItem, kind: ConsumeKind, amount: number) => void;
  onUndo: (item: ReceiptTrackerItem, mode: "one" | "all") => void;
  onRestore: (item: ReceiptTrackerItem) => void;
  onToggle: () => void;
}) {
  const meta = SHELF_META[kind];
  return (
    <section className={`overflow-hidden rounded-lg border ${meta.className}`}>
      <div className={`h-2 bg-gradient-to-r ${meta.railClassName}`} />
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-semibold">{meta.title}</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-950/70 dark:text-zinc-300">
            {items.length}
          </span>
          <button
            type="button"
            onClick={onToggle}
            disabled={empty}
            className="rounded border border-black/10 bg-white/60 px-2 py-0.5 text-xs text-zinc-600 hover:bg-white dark:border-white/10 dark:bg-zinc-950/40 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {empty ? "Empty" : collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>
      {collapsed ? null : <div className="grid min-h-24 grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-1.5 p-1.5 sm:grid-cols-[repeat(auto-fill,minmax(116px,1fr))] sm:gap-2 sm:p-2">
        {items.length === 0 ? (
          <div className="col-span-full grid min-h-24 place-items-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
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
                busy={busyId === item.id || busyId === -1}
                onConsume={(consumeKind, amount) => onConsume(item, consumeKind, amount)}
                onUndo={(mode) => onUndo(item, mode)}
                onRestore={() => onRestore(item)}
              />
            );
          })
        )}
      </div>}
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
  const [filter, setFilter] = useState<InventoryFilter>("active");
  const [sort, setSort] = useState<SortMode>("left");
  const [search, setSearch] = useState("");
  const [collapsedShelves, setCollapsedShelves] = useState<Set<ShelfKind>>(new Set());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const viewStorageKey = `food-tracker:inventory-view:${receipt.id}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(viewStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as SavedInventoryView;
      queueMicrotask(() => {
        if (parsed.filter && ["active", "all", "counter", "stored", "fridge", "pantry", "food", "drink"].includes(parsed.filter)) {
          setFilter(parsed.filter);
        }
        if (parsed.sort && ["name", "left", "calories", "carbs", "protein", "sodium", "recent"].includes(parsed.sort)) {
          setSort(parsed.sort);
        }
        if (typeof parsed.search === "string") setSearch(parsed.search);
        if (Array.isArray(parsed.collapsedShelves)) {
          setCollapsedShelves(new Set(parsed.collapsedShelves.filter((kind) => SHELF_ORDER.includes(kind))));
        }
      });
    } catch {
      queueMicrotask(() => setSaveMessage("Could not load saved view."));
    }
  }, [viewStorageKey]);

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
      if (!filterItem(item, stack, filter, search)) continue;
      next[shelfForItem(item, stack)].push(item);
    }
    for (const key of Object.keys(next) as ShelfKind[]) {
      next[key] = sortItems(next[key], stacks, logs, sort);
    }
    return next;
  }, [items, stacks, filter, search, logs, sort]);
  const calendarRows = useMemo(() => groupLogsByDay(logs, itemsById), [logs, itemsById]);
  const totalLeft = useMemo(
    () => [...stacks.values()].reduce((sum, stack) => sum + stack.left, 0),
    [stacks],
  );
  const counterItems = useMemo(
    () =>
      items.filter((item) => {
        const stack = stacks.get(item.id);
        return stack && shelfForItem(item, stack) === "available";
      }),
    [items, stacks],
  );
  const visibleConsumableItems = useMemo(
    () =>
      [...shelves.available, ...shelves.pantry, ...shelves.fridge].filter((item) => {
        const stack = stacks.get(item.id);
        return stack && stack.left > 0 && !["disposed", "refunded", "unavailable"].includes(item.consumptionStatus);
      }),
    [shelves, stacks],
  );
  const shelfOrder = useMemo(
    () => [...SHELF_ORDER].sort((a, b) => Number(shelves[b].length > 0) - Number(shelves[a].length > 0)),
    [shelves],
  );

  function toggleShelf(kind: ShelfKind) {
    setCollapsedShelves((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function saveView() {
    const payload: SavedInventoryView = {
      filter,
      sort,
      search,
      collapsedShelves: [...collapsedShelves],
    };
    try {
      window.localStorage.setItem(viewStorageKey, JSON.stringify(payload));
      setSaveMessage("View saved.");
    } catch {
      setSaveMessage("Could not save view.");
    }
  }

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

  async function setStatuses(rows: ReceiptTrackerItem[], statusForItem: (item: ReceiptTrackerItem) => ConsumptionStatus) {
    const eligible = rows.filter((item) => !["consumed", "disposed", "refunded", "unavailable"].includes(item.consumptionStatus));
    if (eligible.length === 0) return;
    setBusyId(-1);
    setMessage(null);
    const previous = items;
    const nextById = new Map(eligible.map((item) => [item.id, statusForItem(item)]));
    setItems((current) =>
      current.map((row) => {
        const status = nextById.get(row.id);
        return status ? { ...row, consumptionStatus: status, statusDate: null } : row;
      }),
    );
    try {
      const grouped = new Map<ConsumptionStatus, number[]>();
      for (const item of eligible) {
        const status = statusForItem(item);
        grouped.set(status, [...(grouped.get(status) ?? []), item.id]);
      }
      for (const [status, itemIds] of grouped) {
        const res = await fetch(`/api/receipts/${receipt.id}/items`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemIds, status, statusDate: null }),
        });
        if (!res.ok) throw new Error("bulk status update failed");
      }
    } catch {
      setItems(previous);
      setMessage("Could not auto-store those items.");
    } finally {
      setBusyId(null);
    }
  }

  async function autoStoreCounter() {
    await setStatuses(counterItems, autoStorageStatus);
  }

  async function consumeItem(item: ReceiptTrackerItem, kind: ConsumeKind, amount: number) {
    const stack = stacks.get(item.id);
    const servingAmount = Math.min(amount, stack?.left ?? 0);
    if (!stack || servingAmount <= 0) return;
    setBusyId(item.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/consumption`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineItemId: item.id,
          consumedAt: logAt,
          amount: servingAmount,
          unit: "serving",
          note: `${kind}: ${amountLabel(servingAmount, stack.unitLabel)}`,
        }),
      });
      if (!res.ok) throw new Error("consume failed");
      const data = (await res.json()) as { log: ReceiptConsumptionLog };
      setLogs((current) => [...current, data.log].sort((a, b) => a.consumedAt.localeCompare(b.consumedAt)));
      if (servingAmount >= stack.left) {
        await setStatus(item, "consumed");
      }
    } catch {
      setMessage("Could not log that serving.");
    } finally {
      setBusyId(null);
    }
  }

  async function consumeVisible() {
    const eligible = visibleConsumableItems
      .map((item) => ({ item, stack: stacks.get(item.id) }))
      .filter((row): row is { item: ReceiptTrackerItem; stack: StackInfo } => Boolean(row.stack && row.stack.left > 0));
    if (eligible.length === 0) return;
    setBusyId(-1);
    setMessage(null);
    const previousLogs = logs;
    const previousItems = items;
    try {
      const created: ReceiptConsumptionLog[] = [];
      for (const { item, stack } of eligible) {
        const kind: ConsumeKind = isDrinkItem(item) ? "drank" : "eaten";
        const amount = stack.left;
        const res = await fetch(`/api/receipts/${receipt.id}/consumption`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lineItemId: item.id,
            consumedAt: logAt,
            amount,
            unit: "serving",
            note: `${kind}: ${amountLabel(amount, stack.unitLabel)}`,
          }),
        });
        if (!res.ok) throw new Error("bulk consume failed");
        const data = (await res.json()) as { log: ReceiptConsumptionLog };
        created.push(data.log);
      }

      const finished = eligible.map(({ item }) => item);
      setLogs((current) => [...current, ...created].sort((a, b) => a.consumedAt.localeCompare(b.consumedAt)));
      if (finished.length > 0) {
        const finishedIds = finished.map((item) => item.id);
        setItems((current) =>
          current.map((item) =>
            finishedIds.includes(item.id)
              ? { ...item, consumptionStatus: "consumed", statusDate: logAt.slice(0, 10) }
              : item,
          ),
        );
        const res = await fetch(`/api/receipts/${receipt.id}/items`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemIds: finishedIds, status: "consumed", statusDate: logAt.slice(0, 10) }),
        });
        if (!res.ok) throw new Error("bulk consumed status update failed");
      }
    } catch {
      setLogs(previousLogs);
      setItems(previousItems);
      setMessage("Could not log all visible servings.");
    } finally {
      setBusyId(null);
    }
  }

  async function undoConsumption(item: ReceiptTrackerItem, mode: "one" | "all") {
    const latestLog = latestLogForItem(logs, item.id);
    const matchingLogs = mode === "all" ? logsForItem(logs, item.id) : latestLog ? [latestLog] : [];
    if (matchingLogs.length === 0) {
      if (item.consumptionStatus === "disposed") await setStatus(item, "available");
      return;
    }
    setBusyId(item.id);
    setMessage(null);
    const previousLogs = logs;
    const logIds = new Set(matchingLogs.map((log) => log.id));
    setLogs((current) => current.filter((row) => !logIds.has(row.id)));
    try {
      for (const log of matchingLogs) {
        const res = await fetch(`/api/receipts/${receipt.id}/consumption`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ logId: log.id }),
        });
        if (!res.ok) throw new Error("undo failed");
      }
      if (item.consumptionStatus === "consumed") {
        await setStatus(item, "available");
      }
    } catch {
      setLogs(previousLogs);
      setMessage(mode === "all" ? "Could not undo that stack." : "Could not undo that serving.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-3 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-3 xl:grid-cols-[minmax(150px,190px)_auto_minmax(0,1fr)_auto_auto] xl:items-end">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Inventory clone</div>
            <div className="mt-1 text-lg font-semibold">{formatNumber(totalLeft, 1)} servings left</div>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <button
              type="button"
              onClick={autoStoreCounter}
              disabled={busyId != null || counterItems.length === 0}
              className="rounded-md border border-amber-300 px-3 py-2 text-center text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              Store all
            </button>
            <button
              type="button"
              onClick={consumeVisible}
              disabled={busyId != null || visibleConsumableItems.length === 0}
              className="rounded-md border border-emerald-300 px-3 py-2 text-center text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              Eat all
            </button>
          </div>
          <div className="grid min-w-0 gap-2 min-[520px]:grid-cols-3">
            <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
              Find
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="apple, rice, tea"
                className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
              Show
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as InventoryFilter)}
                className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="active">Active</option>
                <option value="all">All</option>
                <option value="counter">Counter</option>
                <option value="stored">Stored</option>
                <option value="fridge">Fridge</option>
                <option value="pantry">Pantry</option>
                <option value="food">Food</option>
                <option value="drink">Drink</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="left">Servings left</option>
                <option value="recent">Recent use/date</option>
                <option value="carbs">Carbs</option>
                <option value="calories">Calories</option>
                <option value="protein">Protein</option>
                <option value="sodium">Sodium</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <label className="grid min-w-0 gap-1 text-xs text-zinc-500">
            Date and time
            <input
              type="datetime-local"
              value={logAt}
              onChange={(event) => setLogAt(event.target.value)}
              className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <Link
            href={`/receipts/${receipt.id}`}
            className="rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Table
          </Link>
          <button
            type="button"
            onClick={saveView}
            className="rounded-md border border-zinc-200 px-3 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Save view
          </button>
        </div>

        {message || saveMessage ? (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              message
                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
            }`}
          >
            {message ?? saveMessage}
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {shelfOrder.map((kind) => {
            const rows = shelves[kind];
            const empty = rows.length === 0;
            return (
              <Shelf
                key={kind}
                kind={kind}
                items={rows}
                stacks={stacks}
                busyId={busyId}
                collapsed={empty || collapsedShelves.has(kind)}
                empty={empty}
                onConsume={consumeItem}
                onUndo={undoConsumption}
                onRestore={(item) => setStatus(item, "available")}
                onToggle={() => toggleShelf(kind)}
              />
            );
          })}
        </div>
      </div>

      <aside className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Calendar log</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            {logs.length}
          </span>
        </div>
        <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1 xl:max-h-[72vh]">
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
                        {log.note ? <div className="truncate text-[11px] text-zinc-500">{log.note}</div> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => item && undoConsumption(item, "one")}
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
