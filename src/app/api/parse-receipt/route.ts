import { NextRequest, NextResponse } from "next/server";
import { parseReceipt } from "@/lib/llm/parse";
import { db, schema } from "@/db/client";

export const runtime = "nodejs";
export const maxDuration = 120;

type InputKind = "text" | "email" | "image" | "pdf";

const SOURCE_MAP: Record<InputKind, typeof schema.receipts.$inferInsert.source> = {
  text: "manual_text",
  email: "manual_email_paste",
  image: "manual_image",
  pdf: "manual_image",
};

const RAW_KIND_MAP: Record<InputKind, typeof schema.receipts.$inferInsert.rawInputKind> = {
  text: "text",
  email: "email",
  image: "image",
  pdf: "image",
};

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    let parsed;
    let kind: InputKind;
    let rawInputRef: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file in form data" }, { status: 400 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || "image/jpeg";
      const isPdf = mime === "application/pdf";
      kind = isPdf ? "pdf" : "image";
      rawInputRef = `${file.name} (${bytes.byteLength} bytes, ${mime})`;
      parsed = await parseReceipt(
        isPdf ? { kind: "pdf", bytes } : { kind: "image", bytes, mimeType: mime },
      );
    } else {
      const body = (await req.json()) as { kind?: string; text?: string };
      if (!body.text || typeof body.text !== "string") {
        return NextResponse.json({ error: "Missing text" }, { status: 400 });
      }
      kind = body.kind === "email" ? "email" : "text";
      rawInputRef = body.text;
      parsed = await parseReceipt({ kind: "text", text: body.text });
    }

    if (!parsed.is_receipt) {
      return NextResponse.json(
        {
          error: "Input does not look like a grocery receipt",
          parsed,
        },
        { status: 422 },
      );
    }

    const [receipt] = await db
      .insert(schema.receipts)
      .values({
        vendor: parsed.vendor,
        purchasedAt: parsed.purchased_at,
        total: parsed.total,
        source: SOURCE_MAP[kind],
        rawInputKind: RAW_KIND_MAP[kind],
        rawInputRef,
        parseStatus: "parsed",
      })
      .returning();

    if (parsed.items.length > 0) {
      await db.insert(schema.lineItems).values(
        parsed.items.map((it) => ({
          receiptId: receipt.id,
          rawName: it.raw_name,
          quantity: it.quantity,
          unit: it.unit,
          price: it.price,
        })),
      );
    }

    return NextResponse.json({
      receiptId: receipt.id,
      parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("parse-receipt error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
