type VendorMarkId = "tnt" | "costco" | "pricesmart" | "ubereats" | "dutchlove" | "unknown";

type VendorMarkInfo = {
  id: VendorMarkId;
  label: string;
  shortLabel: string;
  className: string;
};

const VENDOR_MARKS: Record<VendorMarkId, VendorMarkInfo> = {
  tnt: {
    id: "tnt",
    label: "T&T Supermarket",
    shortLabel: "T&T",
    className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  },
  costco: {
    id: "costco",
    label: "Costco",
    shortLabel: "Costco",
    className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  },
  pricesmart: {
    id: "pricesmart",
    label: "PriceSmart Foods",
    shortLabel: "PS",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
  ubereats: {
    id: "ubereats",
    label: "Uber Eats",
    shortLabel: "Eats",
    className: "border-zinc-300 bg-zinc-950 text-white dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-950",
  },
  dutchlove: {
    id: "dutchlove",
    label: "Dutch Love",
    shortLabel: "🥬",
    className:
      "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950/40 dark:text-lime-200",
  },
  unknown: {
    id: "unknown",
    label: "Unknown",
    shortLabel: "Mail",
    className: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
  },
};

export function inferVendorMark(value: string | null | undefined): VendorMarkInfo {
  const text = value ?? "";
  if (/\b(?:t&t|tnt|tntsupermarket)\b/i.test(text)) return VENDOR_MARKS.tnt;
  if (/costco/i.test(text)) return VENDOR_MARKS.costco;
  if (/price\s*smart|pricesmart|saveonfoods/i.test(text)) return VENDOR_MARKS.pricesmart;
  if (/uber\s*eats|\bubereats\b|uber\.com/i.test(text)) return VENDOR_MARKS.ubereats;
  if (/dutch\s*love/i.test(text)) return VENDOR_MARKS.dutchlove;
  return VENDOR_MARKS.unknown;
}

export function mainVendorMarks() {
  return [VENDOR_MARKS.tnt, VENDOR_MARKS.costco, VENDOR_MARKS.pricesmart, VENDOR_MARKS.ubereats, VENDOR_MARKS.dutchlove];
}

export function VendorMark({
  text,
  label,
  compact = false,
}: {
  text?: string | null;
  label?: string;
  compact?: boolean;
}) {
  const mark = label
    ? (Object.values(VENDOR_MARKS).find((candidate) => candidate.label === label) ?? inferVendorMark(label))
    : inferVendorMark(text);
  return (
    <span
      title={mark.label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-semibold ${mark.className} ${
        compact ? "h-7 min-w-7 px-1.5 text-[11px]" : "h-9 min-w-10 px-2 text-xs"
      }`}
    >
      {mark.shortLabel}
    </span>
  );
}
