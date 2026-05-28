type ReceiptSignatureInput = {
  vendor: string | null;
  purchasedAt: string | null;
  total: number | null;
};

type ReceiptSignatureItem = {
  rawName: string;
  quantity: number;
  unit: string;
  price: number | null;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/^\[refunded\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : Number(value.toFixed(3)).toString();
}

function normalizedMoney(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : Math.round(value * 100).toString();
}

export function receiptItemsSignature(items: ReceiptSignatureItem[]) {
  return items
    .map((item) =>
      [
        normalizedText(item.rawName),
        normalizedNumber(item.quantity),
        normalizedText(item.unit),
        normalizedMoney(item.price),
      ].join("~"),
    )
    .sort()
    .join("^");
}

export function receiptHeaderSignature(receipt: ReceiptSignatureInput) {
  const date = receipt.purchasedAt?.slice(0, 10) ?? "";
  if (!date && receipt.total == null) return null;
  return [normalizedText(receipt.vendor), date, normalizedMoney(receipt.total)].join("|");
}

export function receiptDedupeSignature(receipt: ReceiptSignatureInput, items: ReceiptSignatureItem[]) {
  const header = receiptHeaderSignature(receipt);
  const itemSignature = receiptItemsSignature(items);
  if (!header || !itemSignature) return null;
  return `${header}|${itemSignature}`;
}
