import { NextRequest, NextResponse } from "next/server";
import { reverseGoogleImageSearch } from "@/lib/products/reverse-image-search";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data with a file field" }, { status: 400 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file in form data" }, { status: 400 });
    }

    const mimeType = file.type || "image/jpeg";
    if (mimeType === "application/pdf" || !mimeType.startsWith("image/")) {
      return NextResponse.json({ error: "Reverse image search expects an image file" }, { status: 400 });
    }

    const result = await reverseGoogleImageSearch(new Uint8Array(await file.arrayBuffer()), mimeType);
    if (!result.configured) {
      return NextResponse.json(
        { error: "GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_VISION_API_KEY is not set", result },
        { status: 503 },
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("reverse-image-search error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
