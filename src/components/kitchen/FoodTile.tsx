import Link from "next/link";
import type { CSSProperties } from "react";
import type { PantryEntry } from "@/lib/pantry/model";
import { leftLabel, tintVar } from "@/lib/pantry/format";
import { FinishButton } from "./FinishButton";

// Shows the food's cutout photo when it has one, else its emoji. The photo is sized in em,
// so the same text-* class that scales the emoji scales the photo too.
export function FoodEmoji({
  emoji,
  name,
  imageUrl,
  className = "text-5xl",
}: {
  emoji: string | null;
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        loading="lazy"
        className={`food-object h-[1.7em] w-[1.7em] object-contain ${className}`}
      />
    );
  }
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
  action,
}: {
  entry: PantryEntry;
  size?: "sm" | "md";
  caption?: string;
  // "finish" adds a used-it-up button, "restore" a back-in-pantry one.
  action?: "finish" | "restore";
}) {
  const { food } = entry;
  const style = { "--tint": tintVar(food.kind), "--level": entry.remaining } as CSSProperties;

  return (
    <div className="group/tile relative">
    {action && <FinishButton slug={food.slug} finished={action === "restore"} />}
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
          imageUrl={food.imageUrl}
          className={`${size === "sm" ? "text-4xl" : "text-5xl sm:text-6xl"} group-hover:-translate-y-1`}
        />
      </div>
      <div className="mt-2.5 px-0.5">
        <div className="label-caps line-clamp-2 text-ink">{food.name}</div>
        <div className="label-mono mt-0.5 truncate text-ink-faint">{caption ?? leftLabel(entry)}</div>
      </div>
    </Link>
    </div>
  );
}
