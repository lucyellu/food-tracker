import Link from "next/link";

const nutrients = [
  { key: "calories", label: "Daily calories / person", value: "1,983", signal: "↑ 138% target" },
  { key: "protein", label: "Daily protein / person", value: "88g", signal: "↑ 192% target" },
  { key: "carbs", label: "Daily carbs / person", value: "213g", signal: "↑ 132% target" },
  { key: "fat", label: "Daily fat / person", value: "82g", signal: "↑↑ 172% target" },
  { key: "sodium", label: "Daily sodium / person", value: "10,671mg", signal: "↑↑ 464% target" },
  { key: "potassium", label: "Daily potassium / person", value: "2,643mg", signal: "→ 102% target" },
  { key: "caffeine", label: "Daily caffeine / person", value: "95mg", signal: "manual entry" },
  { key: "alcohol", label: "Daily alcohol / person", value: "14g", signal: "manual entry" },
] as const;

const emojiByKey: Record<string, string> = {
  calories: "🔥",
  protein: "🥚",
  carbs: "🍚",
  fat: "🧈",
  fiber: "🫘",
  sugar: "🍬",
  sodium: "🧂",
  potassium: "🍌",
  caffeine: "☕",
  alcohol: "🍷",
  cannabis: "🌿",
  medication: "💊",
};

const codeByKey: Record<string, string> = {
  calories: "cal",
  protein: "P",
  carbs: "C",
  fat: "F",
  fiber: "fiber",
  sugar: "sugar",
  sodium: "Na",
  potassium: "K",
  caffeine: "caf",
  alcohol: "alc",
  cannabis: "THC",
  medication: "Rx",
};

const variants = [
  {
    id: "emoji-badge",
    mode: "emojiBadge",
    name: "Emoji badges",
    note: "Fastest recognition; familiar symbols with a quiet card-sized badge.",
    score: "Most readable",
  },
  {
    id: "emoji-code",
    mode: "emojiCode",
    name: "Emoji + nutrient code",
    note: "Emoji for speed, tiny code for nutrients that are easy to confuse.",
    score: "Clearest",
  },
  {
    id: "emoji-plain",
    mode: "emojiPlain",
    name: "Plain emoji",
    note: "Least visual chrome, but emoji font style varies by device.",
    score: "Cleanest",
  },
  {
    id: "current",
    mode: "image",
    name: "Current nutrient stickers",
    note: "Most direct mapping to nutrients and active tracking.",
    score: "Best current fit",
    path: (key: string) => `/nutrients/${key}.png`,
  },
  {
    id: "pack1",
    mode: "image",
    name: "Pack 1 cute food stickers",
    note: "Warmest and friendliest, but uses food proxies for nutrients.",
    score: "Most charming",
    path: (key: string) => `/icon-tests/candidates/pack1-${key}.png`,
  },
  {
    id: "pack2",
    mode: "image",
    name: "Pack 2 doodle stickers",
    note: "Hand-drawn look, but black linework competes with dense tables.",
    score: "Busy at scale",
    path: (key: string) => `/icon-tests/candidates/pack2-${key}.png`,
  },
  {
    id: "pack3",
    mode: "image",
    name: "Pack 3 object-library crops",
    note: "Lots of source material, but needs careful extraction.",
    score: "Needs cleanup",
    path: (key: string) => `/icon-tests/candidates/pack3-${key}.png`,
  },
] as const;

function IconMark({
  variant,
  nutrientKey,
  small = false,
}: {
  variant: (typeof variants)[number];
  nutrientKey: string;
  small?: boolean;
}) {
  if (variant.mode === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={variant.path(nutrientKey)}
        alt=""
        className={`${small ? "h-8 w-8" : "h-9 w-9"} shrink-0 object-contain`}
        loading="lazy"
      />
    );
  }

  const emoji = emojiByKey[nutrientKey] ?? "•";
  const code = codeByKey[nutrientKey] ?? nutrientKey.slice(0, 3);
  if (variant.mode === "emojiPlain") {
    return (
      <span
        className={`${small ? "h-8 w-8 text-2xl" : "h-9 w-9 text-3xl"} grid shrink-0 place-items-center leading-none`}
        aria-hidden="true"
      >
        {emoji}
      </span>
    );
  }

  return (
    <span
      className={`${
        small ? "h-8 w-8 text-xl" : "h-9 w-9 text-2xl"
      } grid shrink-0 place-items-center rounded-lg border border-zinc-700 bg-zinc-950 shadow-sm`}
      aria-hidden="true"
    >
      <span className="leading-none">{emoji}</span>
      {variant.mode === "emojiCode" ? (
        <span className="mt-[-2px] text-[8px] font-semibold uppercase leading-none text-zinc-500">{code}</span>
      ) : null}
    </span>
  );
}

function NutrientCard({
  label,
  value,
  signal,
  nutrientKey,
  variant,
}: {
  label: string;
  value: string;
  signal: string;
  nutrientKey: string;
  variant: (typeof variants)[number];
}) {
  const high = signal.includes("↑");
  const target = signal.includes("→");
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-zinc-100">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">{label}</div>
          <div className="mt-1 text-xl font-semibold">{value}</div>
        </div>
        <IconMark variant={variant} nutrientKey={nutrientKey} />
      </div>
      <div
        className={`mt-1 truncate text-xs font-medium ${
          high ? "text-amber-400" : target ? "text-emerald-400" : "text-zinc-500"
        }`}
      >
        {signal}
      </div>
    </div>
  );
}

function ReceiptRow({
  name,
  tag,
  nutrientKey,
  variant,
}: {
  name: string;
  tag: string;
  nutrientKey: string;
  variant: (typeof variants)[number];
}) {
  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-800/70">
      <td className="px-2 py-2">
        <input type="checkbox" aria-label={`Select ${name}`} className="h-3.5 w-3.5" />
      </td>
      <td className="px-2 py-2">
        <div className="flex min-w-56 items-center gap-2">
          <IconMark variant={variant} nutrientKey={nutrientKey} small />
          <div>
            <div className="max-w-56 truncate text-xs font-medium text-zinc-100">{name}</div>
            <div className="text-[11px] text-zinc-500">mock receipt row</div>
          </div>
        </div>
      </td>
      <td className="px-2 py-2 text-[11px] text-zinc-400">{tag}</td>
      <td className="px-2 py-2 text-right text-[11px] text-zinc-400">shown at 32px</td>
    </tr>
  );
}

export default function IconTestsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Icon Tests In App Context</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Same receipt-style cards, same dark UI, same card density. This should make the choice feel less abstract
            than the image board.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/receipts/1"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            Back to receipt
          </Link>
          <a
            href="/icon-tests/index.html"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            Raw board
          </a>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {variants.map((variant) => (
          <section key={variant.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">{variant.name}</h2>
                <p className="mt-1 text-xs text-zinc-500">{variant.note}</p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{variant.score}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {nutrients.map((nutrient) => (
                <NutrientCard
                  key={nutrient.key}
                  label={nutrient.label}
                  value={nutrient.value}
                  signal={nutrient.signal}
                  nutrientKey={nutrient.key}
                  variant={variant}
                />
              ))}
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full text-left">
                <thead className="bg-zinc-900 text-xs text-zinc-500">
                  <tr>
                    <th className="w-8 px-2 py-2 font-medium"></th>
                    <th className="px-2 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Tag</th>
                    <th className="px-2 py-2 text-right font-medium">Readability</th>
                  </tr>
                </thead>
                <tbody>
                  <ReceiptRow name="Coffee / tea" tag="caffeine" nutrientKey="caffeine" variant={variant} />
                  <ReceiptRow name="Wine / drink" tag="alcohol" nutrientKey="alcohol" variant={variant} />
                  <ReceiptRow name="Sugar signal" tag="nutrient" nutrientKey="sugar" variant={variant} />
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
