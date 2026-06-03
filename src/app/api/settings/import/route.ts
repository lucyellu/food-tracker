import { NextRequest, NextResponse } from "next/server";
import { importFoodTrackerData } from "@/lib/data-transfer";
import { revalidateFoodDataCache } from "@/lib/food-data-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const summary = await importFoodTrackerData(data);
    revalidateFoodDataCache();
    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
