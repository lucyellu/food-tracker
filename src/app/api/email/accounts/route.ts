import { NextRequest, NextResponse } from "next/server";
import { saveYahooImapAccount, summarizeEmailAccount } from "@/lib/email/accounts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      provider?: string;
      email?: string;
      password?: string;
      mailbox?: string;
    };

    if (body.provider !== "yahoo_imap") {
      return NextResponse.json({ error: "Unsupported email provider" }, { status: 400 });
    }
    if (!body.email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!body.password) {
      return NextResponse.json({ error: "Yahoo app password is required" }, { status: 400 });
    }

    const account = await saveYahooImapAccount({
      email: body.email,
      password: body.password,
      mailbox: body.mailbox,
    });

    return NextResponse.json({ account: summarizeEmailAccount(account) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
