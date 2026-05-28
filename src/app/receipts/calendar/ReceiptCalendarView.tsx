"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Search, ShoppingBag, Utensils } from "lucide-react";
import { useMemo, useState } from "react";

type DateMode = "bought" | "consumed";

export type CalendarReceipt = {
  id: number;
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
  source: string;
  createdAt: string | null;
  itemCount: number;
};

export type CalendarItem = {
  id: number;
  receiptId: number;
  rawName: string;
  quantity: number;
  unit: string;
  price: number | null;
  consumptionStatus: string;
  statusDate: string | null;
  receiptVendor: string | null;
  receiptPurchasedAt: string | null;
  receiptCreatedAt: string | null;
};

export type CalendarLog = {
  id: number;
  receiptId: number;
  lineItemId: number;
  consumedAt: string;
  amount: number;
  unit: "item" | "serving" | "g" | "100g";
  note: string | null;
};

type CalendarEvent =
  | {
      id: string;
      date: string;
      kind: "receipt";
      receipt: CalendarReceipt;
    }
  | {
      id: string;
      date: string;
      kind: "log";
      item: CalendarItem;
      log: CalendarLog | null;
    };

type ItemRow = {
  id: string;
  date: string | null;
  item: CalendarItem;
  log: CalendarLog | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function datePart(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function monthStartIso(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(value: string, amount: number) {
  const date = new Date(`${monthStartIso(value)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function calendarDays(cursor: string) {
  const start = new Date(`${monthStartIso(cursor)}T00:00:00.000Z`);
  const gridStart = addDays(start.toISOString().slice(0, 10), -start.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function monthTitle(value: string) {
  return new Date(`${monthStartIso(value)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(value: number | null) {
  if (value == null) return "";
  return `$${value.toFixed(2)}`;
}

function formatQty(quantity: number, unit: string) {
  const amount = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  return `${amount} ${unit}`;
}

function eventDateForReceipt(receipt: CalendarReceipt) {
  return datePart(receipt.purchasedAt);
}

function boughtDateForItem(item: CalendarItem) {
  return datePart(item.receiptPurchasedAt);
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function modeClasses(active: boolean) {
  return active
    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
    : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800";
}

function eventMatchesSearch(event: CalendarEvent, search: string) {
  if (!search) return true;
  const haystack =
    event.kind === "receipt"
      ? `${event.receipt.vendor ?? ""} ${event.receipt.total ?? ""}`
      : `${event.item.rawName} ${event.item.receiptVendor ?? ""} ${event.log?.note ?? ""}`;
  return haystack.toLowerCase().includes(search);
}

export function ReceiptCalendarView({
  receipts,
  items,
  logs,
}: {
  receipts: CalendarReceipt[];
  items: CalendarItem[];
  logs: CalendarLog[];
}) {
  const [mode, setMode] = useState<DateMode>("bought");
  const latestBoughtDate = receipts
    .map((receipt) => datePart(receipt.purchasedAt))
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const [cursor, setCursor] = useState(monthStartIso(latestBoughtDate ?? todayIso()));
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const logsByItemId = useMemo(() => {
    const map = new Map<number, CalendarLog[]>();
    for (const log of logs) {
      const list = map.get(log.lineItemId) ?? [];
      list.push(log);
      map.set(log.lineItemId, list);
    }
    return map;
  }, [logs]);

  const receiptEvents = useMemo<CalendarEvent[]>(
    () =>
      receipts.flatMap((receipt) => {
        const date = eventDateForReceipt(receipt);
        return date
          ? [
              {
                id: `receipt-${receipt.id}`,
                kind: "receipt" as const,
                receipt,
                date,
              },
            ]
          : [];
      }),
    [receipts],
  );

  const consumedEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    const loggedItemIds = new Set<number>();

    for (const log of logs) {
      const item = itemsById.get(log.lineItemId);
      const date = datePart(log.consumedAt);
      if (!item || !date) continue;
      loggedItemIds.add(item.id);
      events.push({ id: `log-${log.id}`, kind: "log", item, log, date });
    }

    for (const item of items) {
      const date = datePart(item.statusDate);
      if (item.consumptionStatus !== "consumed" || !date || loggedItemIds.has(item.id)) continue;
      events.push({ id: `status-${item.id}`, kind: "log", item, log: null, date });
    }

    return events;
  }, [items, itemsById, logs]);

  const activeEvents = useMemo(() => {
    const events = mode === "bought" ? receiptEvents : consumedEvents;
    return events.filter((event) => eventMatchesSearch(event, query));
  }, [consumedEvents, mode, query, receiptEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of activeEvents) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [activeEvents]);

  const itemRows = useMemo<ItemRow[]>(() => {
    const rows: ItemRow[] = [];
    if (mode === "bought") {
      for (const item of items) {
        rows.push({ id: `item-${item.id}`, date: boughtDateForItem(item), item, log: null });
      }
    } else {
      for (const item of items) {
        const itemLogs = logsByItemId.get(item.id) ?? [];
        if (itemLogs.length > 0) {
          for (const log of itemLogs) {
            const date = datePart(log.consumedAt);
            if (date) rows.push({ id: `log-${log.id}`, date, item, log });
          }
        } else if (item.consumptionStatus === "consumed") {
          rows.push({ id: `status-${item.id}`, date: datePart(item.statusDate) ?? boughtDateForItem(item), item, log: null });
        }
      }
    }

    return rows
      .filter((row) => {
        if (!query) return true;
        return `${row.item.rawName} ${row.item.receiptVendor ?? ""} ${row.log?.note ?? ""}`.toLowerCase().includes(query);
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.item.rawName.localeCompare(b.item.rawName));
  }, [items, logsByItemId, mode, query]);

  const days = calendarDays(cursor);
  const selectedMonth = cursor.slice(0, 7);
  const monthEvents = activeEvents.filter((event) => event.date.slice(0, 7) === selectedMonth);
  const receiptSpend = mode === "bought"
    ? monthEvents.reduce((sum, event) => sum + (event.kind === "receipt" ? event.receipt.total ?? 0 : 0), 0)
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/receipts" className="text-sm text-zinc-500 hover:underline">
            All receipts
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Receipt calendar</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="h-10 w-48 rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
            />
          </div>
          <button
            type="button"
            onClick={() => setMode("bought")}
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${modeClasses(mode === "bought")}`}
          >
            <ShoppingBag className="size-4" />
            Bought
          </button>
          <button
            type="button"
            onClick={() => setMode("consumed")}
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium ${modeClasses(mode === "consumed")}`}
          >
            <Utensils className="size-4" />
            Consumed
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">Month</div>
          <div className="mt-2 text-xl font-semibold">{monthTitle(cursor)}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">{mode === "bought" ? "Receipts" : "Consumed entries"}</div>
          <div className="mt-2 text-xl font-semibold">{monthEvents.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">{mode === "bought" ? "Spend" : "Items"}</div>
          <div className="mt-2 text-xl font-semibold">
            {mode === "bought" ? formatMoney(receiptSpend) || "$0.00" : new Set(monthEvents.map((event) => event.kind === "log" ? event.item.id : event.id)).size}
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <div className="inline-flex items-center gap-2 font-medium">
            <CalendarDays className="size-4" />
            {monthTitle(cursor)}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, -1))}
              className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(monthStartIso(todayIso()))}
              className="h-9 rounded-md border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[880px] p-3">
            <div className="grid grid-cols-7 gap-2 pb-2 text-xs font-medium uppercase text-zinc-500">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="px-2">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {days.map((day) => {
                const dayEvents = eventsByDate.get(day) ?? [];
                const outsideMonth = day.slice(0, 7) !== selectedMonth;
                const total = dayEvents.reduce(
                  (sum, event) => sum + (event.kind === "receipt" ? event.receipt.total ?? 0 : 0),
                  0,
                );
                return (
                  <div
                    key={day}
                    className={`min-h-36 rounded-md border p-2 ${
                      outsideMonth
                        ? "border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-950"
                        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{Number(day.slice(8, 10))}</span>
                      {dayEvents.length > 0 ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {dayEvents.length}
                        </span>
                      ) : null}
                    </div>
                    {mode === "bought" && total > 0 ? (
                      <div className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{formatMoney(total)}</div>
                    ) : null}
                    <div className="mt-2 space-y-1">
                      {dayEvents.slice(0, 4).map((event) =>
                        event.kind === "receipt" ? (
                          <Link
                            key={event.id}
                            href={`/receipts/${event.receipt.id}`}
                            className="block truncate rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          >
                            {event.receipt.vendor ?? "Unknown"} {formatMoney(event.receipt.total)}
                          </Link>
                        ) : (
                          <Link
                            key={event.id}
                            href={`/receipts/${event.item.receiptId}`}
                            className="block truncate rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          >
                            {event.item.rawName}
                          </Link>
                        ),
                      )}
                      {dayEvents.length > 4 ? (
                        <div className="px-2 text-xs text-zinc-500">+{dayEvents.length - 4}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">Itemized</h2>
          <span className="text-sm text-zinc-500">{itemRows.length} rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Receipt</th>
                <th className="px-4 py-3 font-medium text-right">{mode === "bought" ? "Quantity" : "Amount"}</th>
                <th className="px-4 py-3 font-medium text-right">{mode === "bought" ? "Price" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDate(row.date)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/receipts/${row.item.receiptId}`} className="font-medium hover:underline">
                      {row.item.rawName}
                    </Link>
                    {row.log?.note ? <div className="mt-1 text-xs text-zinc-500">{row.log.note}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{row.item.receiptVendor ?? "Unknown"}</td>
                  <td className="px-4 py-3 text-right">
                    {row.log ? formatQty(row.log.amount, row.log.unit) : formatQty(row.item.quantity, row.item.unit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {mode === "bought" ? formatMoney(row.item.price) || "—" : statusLabel(row.item.consumptionStatus)}
                  </td>
                </tr>
              ))}
              {itemRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                    No rows
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
