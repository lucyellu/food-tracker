import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";
import { getToday } from "@/lib/pantry/today";

export const runtime = "nodejs";

// { finished: true } marks the food used up as of today; { finished: false } puts it back in the pantry.
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const { finished } = (await req.json()) as { finished?: boolean };
  const food = await db.query.foods.findFirst({ where: eq(schema.foods.slug, slug) });
  if (!food) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (finished === false) {
    await db.delete(schema.foodFinished).where(eq(schema.foodFinished.foodId, food.id));
  } else {
    const finishedAt = await getToday();
    await db
      .insert(schema.foodFinished)
      .values({ foodId: food.id, finishedAt })
      .onConflictDoUpdate({ target: schema.foodFinished.foodId, set: { finishedAt } });
  }
  revalidateFoodDataCache();
  return NextResponse.json({ ok: true });
}
