import type { GmailMerchantPresetId } from "@/lib/gmail/merchant-presets";

type EmailLike = {
  fromAddress?: string | null;
  subject?: string | null;
  text?: string | null;
  merchant?: GmailMerchantPresetId;
};

const OBVIOUS_NON_INVENTORY_RULES: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "Skipped obvious non-inventory email: property tax bill",
    pattern: /\b(?:property\s+tax|taxbilling@richmond\.ca|city\s+of\s+richmond|richmond\.ca)\b/i,
  },
  {
    reason: "Skipped obvious non-inventory email: event ticket",
    pattern: /\b(?:eventbrite|noreply@order\.eventbrite\.com|your\s+tickets?\s+for|tickets?\s+for)\b/i,
  },
  {
    reason: "Skipped obvious non-inventory email: travel booking",
    pattern: /\b(?:boarding\s+pass|flight\s+itinerary|hotel\s+reservation|rental\s+car\s+reservation)\b/i,
  },
];

export function obviousNonInventoryReason({
  fromAddress,
  subject,
  text,
  merchant = "all",
}: EmailLike) {
  if (merchant !== "all") return null;

  const haystack = [fromAddress, subject, text]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);

  for (const rule of OBVIOUS_NON_INVENTORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.reason;
  }

  return null;
}

export function isReusableSkipReason(value: string | null | undefined) {
  return /did not look like a receipt|No readable|No matching|Duplicate|obvious non-inventory/i.test(
    value ?? "",
  );
}
