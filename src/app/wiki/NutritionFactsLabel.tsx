import type { WikiNutrition } from "@/lib/wiki";
import { formatWikiNumber } from "@/lib/wiki";

type NutritionFactsLabelProps = {
  title: string;
  servingName: string;
  nutrition: WikiNutrition;
};

const DAILY_VALUES = {
  fatG: 78,
  carbsG: 275,
  fiberG: 28,
  sodiumMg: 2300,
  proteinG: 50,
};

function percent(value: number | null, dailyValue: number) {
  if (!value || value <= 0) return null;
  return `${Math.round((value / dailyValue) * 100)}%`;
}

function amount(value: number | null, unit: string) {
  if (!value || value <= 0) return "0";
  return formatWikiNumber(value, unit);
}

function NutrientRow({
  label,
  value,
  unit,
  daily,
  indent = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  daily?: number;
  indent?: boolean;
}) {
  const dailyPercent = daily ? percent(value, daily) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline border-t border-black py-1 leading-none">
      <div className={indent ? "pl-4" : ""}>
        <span className={indent ? "font-normal" : "font-black"}>{label}</span>{" "}
        <span>{amount(value, unit)}</span>
      </div>
      <div className="font-black">{dailyPercent ?? ""}</div>
    </div>
  );
}

export function NutritionFactsLabel({
  title,
  servingName,
  nutrition,
}: NutritionFactsLabelProps) {
  const activeRows = [
    nutrition.caffeineMg && nutrition.caffeineMg > 0 ? `Caffeine ${amount(nutrition.caffeineMg, "mg")}` : null,
    nutrition.alcoholG && nutrition.alcoholG > 0 ? `Alcohol ${amount(nutrition.alcoholG, "g")}` : null,
    nutrition.thcMg && nutrition.thcMg > 0 ? `THC ${amount(nutrition.thcMg, "mg")}` : null,
    nutrition.cbdMg && nutrition.cbdMg > 0 ? `CBD ${amount(nutrition.cbdMg, "mg")}` : null,
  ].filter(Boolean);

  return (
    <aside className="w-full max-w-[420px] border-2 border-black bg-white p-2 text-black shadow-sm sm:p-3">
      <div className="border-b border-black pb-1">
        <div className="text-[2rem] font-black leading-none tracking-normal sm:text-[2.5rem]">
          Nutrition Facts
        </div>
        <div className="mt-1 text-sm font-bold leading-tight">{title}</div>
      </div>

      <div className="border-b-[10px] border-black py-1 text-sm leading-tight">
        <div className="font-bold">Serving size</div>
        <div>{servingName}</div>
        {nutrition.totalGrams && nutrition.totalGrams > 0 ? (
          <div className="text-xs">Typical observed weight {amount(nutrition.totalGrams, "g")}</div>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-3 border-b-[6px] border-black py-1">
        <div>
          <div className="text-xs font-black">Amount per serving</div>
          <div className="text-3xl font-black leading-none">Calories</div>
        </div>
        <div className="text-4xl font-black leading-none">
          {nutrition.calories && nutrition.calories > 0 ? formatWikiNumber(nutrition.calories) : "0"}
        </div>
      </div>

      <div className="border-b border-black py-1 text-right text-xs font-black">% Daily Value*</div>
      <NutrientRow label="Total Fat" value={nutrition.fatG} unit="g" daily={DAILY_VALUES.fatG} />
      <NutrientRow label="Total Carbohydrate" value={nutrition.carbsG} unit="g" daily={DAILY_VALUES.carbsG} />
      <NutrientRow label="Dietary Fiber" value={nutrition.fiberG} unit="g" daily={DAILY_VALUES.fiberG} indent />
      <NutrientRow label="Total Sugars" value={nutrition.sugarG} unit="g" indent />
      <NutrientRow label="Protein" value={nutrition.proteinG} unit="g" daily={DAILY_VALUES.proteinG} />
      <NutrientRow label="Sodium" value={nutrition.sodiumMg} unit="mg" daily={DAILY_VALUES.sodiumMg} />

      {activeRows.length ? (
        <div className="border-t-[6px] border-black py-2">
          <div className="text-xs font-black uppercase">Tracked active ingredients</div>
          <div className="mt-1 grid gap-1 text-sm font-bold sm:grid-cols-2">
            {activeRows.map((row) => (
              <div key={row}>{row}</div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="border-t border-black pt-1 text-[11px] leading-tight">
        * Values are averaged from your observed receipt lines, not a manufacturer serving-size guarantee.
      </p>
    </aside>
  );
}
