import Link from "next/link";
import type { CSSProperties } from "react";
import type { PantryEntry } from "@/lib/pantry/model";
import { leftLabel, tintVar } from "@/lib/pantry/format";

export function FoodEmoji({
  emoji,
  name,
  className = "text-5xl",
}: {
  emoji: string | null;
  name: string;
  className?: string;
}) {
  return (
    <span role="img" aria-label={name} className={`food-object ${className}`}>
      {emoji ?? "🥣"}
    </span>
  );
}

export function FoodTile({
  entry,
  size = "md",
  caption,
}: {
  entry: PantryEntry;
  size?: "sm" | "md";
  caption?: string;
}) {
  const { food } = entry;
  const style = { "--tint": tintVar(food.kind), "--level": entry.remaining } as CSSProperties;

  return (
    <Link href={`/food/${food.slug}`} className="group block focus-visible:outline-none">
      <div
        style={style}
        className={`food-level relative flex aspect-square items-center justify-center transition group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-ink ${
          size === "sm" ? "rounded-2xl" : "rounded-[1.4rem]"
        }`}
      >
        <FoodEmoji
          emoji={food.emoji}
          name={food.name}
          className={`${size === "sm" ? "text-4xl" : "text-5xl sm:text-6xl"} group-hover:-translate-y-1`}
        />
      </div>
      <div className="mt-2.5 px-0.5">
        <div className="label-caps line-clamp-2 text-ink">{food.name}</div>
        <div className="label-mono mt-0.5 truncate text-ink-faint">{caption ?? leftLabel(entry)}</div>
      </div>
    </Link>
  );
}
