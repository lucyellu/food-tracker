import { NextResponse } from "next/server";
import { listEmailAccounts, summarizeEmailAccount } from "@/lib/email/accounts";

export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  try {
    const accounts = (await listEmailAccounts()).map(summarizeEmailAccount);
    const enabledAccounts = accounts.filter((account) => account.enabled);
    return NextResponse.json({
      configured,
      connected: enabledAccounts.length > 0,
      email:
        enabledAccounts.length === 1
          ? enabledAccounts[0].email
          : enabledAccounts.length > 1
            ? `${enabledAccounts.length} inboxes`
            : null,
      query: enabledAccounts.map((account) => account.mailbox).join(", ") || null,
      accounts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        configured,
        connected: false,
        email: null,
        query: null,
        accounts: [],
        error: msg.includes("Failed query")
          ? "Could not read email settings. Check DATABASE_URL and run npm run db:push."
          : msg,
      },
      { status: 500 },
    );
  }
}
