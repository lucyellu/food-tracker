import { NextResponse } from "next/server";
import { exportFoodTrackerData } from "@/lib/data-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await exportFoodTrackerData();
  return NextResponse.json(data, {
    headers: {
      "content-disposition": `attachment; filename="food-tracker-export-${data.exportedAt.slice(0, 10)}.json"`,
    },
  });
}
