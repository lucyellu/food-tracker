import { NextRequest, NextResponse } from "next/server";
import { canonicalizeProducts } from "@/lib/foods/canonicalize";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";

export const runtime = "nodejs";
export const maxDuration = 120;

// Processes one batch of products without a canonical food. Call repeatedly
// until `remaining` reaches 0.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 120);
  try {
    const result = await canonicalizeProducts({ limit });
    if (result.assigned > 0) revalidateFoodDataCache();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("food canonicalize error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
