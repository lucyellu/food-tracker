import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  refreshGoogleAccessToken,
  type GoogleTokenResponse,
} from "@/lib/gmail/oauth";
import { parseReceipt } from "@/lib/llm/parse";
import { findDuplicateParsedReceipt } from "@/lib/receipts/dedupe";
import { resolveReceiptPurchasedDate } from "@/lib/receipts/dates";
import { persistParsedReceipt } from "@/lib/receipts/persist";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

const PHOTOS_PICKER_API_BASE = "https://photospicker.googleapis.com/v1";
export const GOOGLE_PHOTOS_PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
export const GOOGLE_PHOTOS_SCOPES = ["openid", "email", GOOGLE_PHOTOS_PICKER_SCOPE] as const;

const MISSING_PHOTOS_SCOPE_MESSAGE =
  "Google connected without Photos picker permission. Connect Google Photos again and approve selected-photo access.";

type PickingSession = {
  id: string;
  pickerUri?: string;
  pollingConfig?: {
    pollInterval?: string;
    timeoutIn?: string;
  };
  expireTime?: string;
  mediaItemsSet?: boolean;
};

type PickedMediaItem = {
  id: string;
  createTime?: string;
  type?: "TYPE_UNSPECIFIED" | "PHOTO" | "VIDEO";
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
  };
};

type PickedMediaListResponse = {
  mediaItems?: PickedMediaItem[];
  nextPageToken?: string;
};

type GoogleApiErrorResponse = {
  error?: {
    message?: string;
    status?: string;
  };
};

export type GooglePhotosImportResult = {
  ready: boolean;
  session?: PickingSession;
  selected: number;
  parsed: number;
  duplicates: number;
  skipped: number;
  failed: number;
  receipts: Array<{ id: number; vendor: string | null; purchasedAt: string | null; total: number | null }>;
};

export function isGooglePhotosConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.EMAIL_ENCRYPTION_KEY,
  );
}

export function buildGooglePhotosAuthUrl(reqUrl: string, state: string) {
  return buildGoogleAuthUrl(reqUrl, state, GOOGLE_PHOTOS_SCOPES);
}

export async function exchangeCodeForGooglePhotosTokens(reqUrl: string, code: string) {
  return exchangeCodeForTokens(
    reqUrl,
    code,
    GOOGLE_PHOTOS_PICKER_SCOPE,
    MISSING_PHOTOS_SCOPE_MESSAGE,
  );
}

export async function saveGooglePhotosConnection(tokens: GoogleTokenResponse, email: string | null) {
  if (!tokens.refresh_token) {
    throw new Error("Missing Google Photos refresh token");
  }

  await db
    .insert(schema.googlePhotoConnections)
    .values({
      id: 1,
      email,
      secretEncrypted: encryptSecret(tokens.refresh_token),
      enabled: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.googlePhotoConnections.id,
      set: {
        email,
        secretEncrypted: encryptSecret(tokens.refresh_token),
        enabled: true,
        updatedAt: new Date(),
      },
    });
}

export async function getGooglePhotosStatus() {
  const [connection] = await db
    .select()
    .from(schema.googlePhotoConnections)
    .where(eq(schema.googlePhotoConnections.id, 1))
    .limit(1);

  return {
    configured: isGooglePhotosConfigured(),
    connected: Boolean(connection?.enabled),
    email: connection?.enabled ? connection.email : null,
  };
}

async function getGooglePhotosAccessToken() {
  const [connection] = await db
    .select()
    .from(schema.googlePhotoConnections)
    .where(eq(schema.googlePhotoConnections.id, 1))
    .limit(1);
  if (!connection?.enabled) {
    throw new Error("Google Photos is not connected yet");
  }

  return refreshGoogleAccessToken(
    decryptSecret(connection.secretEncrypted),
    GOOGLE_PHOTOS_PICKER_SCOPE,
    MISSING_PHOTOS_SCOPE_MESSAGE,
  );
}

async function photosFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit & { params?: Record<string, string> } = {},
) {
  const url = new URL(`${PHOTOS_PICKER_API_BASE}${path}`);
  const { params, ...fetchInit } = init;
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    ...fetchInit,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & GoogleApiErrorResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `Google Photos API request failed (${res.status})`);
  }
  return data as T;
}

export async function createGooglePhotosPickerSession(maxItemCount = 10) {
  const accessToken = await getGooglePhotosAccessToken();
  const count = Math.min(Math.max(Math.floor(maxItemCount), 1), 50);
  const session = await photosFetch<PickingSession>("/sessions", accessToken, {
    method: "POST",
    body: JSON.stringify({ pickingConfig: { maxItemCount: String(count) } }),
  });
  if (!session.id || !session.pickerUri) {
    throw new Error("Google Photos did not return a picker session");
  }
  return session;
}

export async function getGooglePhotosPickerSession(sessionId: string) {
  const accessToken = await getGooglePhotosAccessToken();
  return photosFetch<PickingSession>(`/sessions/${encodeURIComponent(sessionId)}`, accessToken);
}

async function listPickedMediaItems(sessionId: string, accessToken: string) {
  const mediaItems: PickedMediaItem[] = [];
  let pageToken: string | undefined;

  do {
    const page = await photosFetch<PickedMediaListResponse>("/mediaItems", accessToken, {
      params: {
        sessionId,
        pageSize: "25",
        ...(pageToken ? { pageToken } : {}),
      },
    });
    mediaItems.push(...(page.mediaItems ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return mediaItems;
}

async function downloadPickedPhoto(item: PickedMediaItem, accessToken: string) {
  const baseUrl = item.mediaFile?.baseUrl;
  if (!baseUrl) throw new Error("Picked photo is missing a download URL");

  const res = await fetch(`${baseUrl}=w2400-h2400`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Could not download picked photo (${res.status})`);
  }
  const contentType = res.headers.get("content-type") ?? item.mediaFile?.mimeType ?? "image/jpeg";
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mimeType: contentType.split(";")[0] || "image/jpeg",
  };
}

export async function importGooglePhotosPickerSession(sessionId: string): Promise<GooglePhotosImportResult> {
  const accessToken = await getGooglePhotosAccessToken();
  const session = await photosFetch<PickingSession>(`/sessions/${encodeURIComponent(sessionId)}`, accessToken);
  const result: GooglePhotosImportResult = {
    ready: Boolean(session.mediaItemsSet),
    session,
    selected: 0,
    parsed: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    receipts: [],
  };

  if (!session.mediaItemsSet) return result;

  const mediaItems = await listPickedMediaItems(sessionId, accessToken);
  result.selected = mediaItems.length;

  for (const item of mediaItems) {
    if (item.type && item.type !== "PHOTO") {
      console.warn(`[photos] skip ${item.id}: type=${item.type} (not PHOTO)`);
      result.skipped += 1;
      continue;
    }

    const sourceMessageId = `google-photos:${item.id}`;
    const [existing] = await db
      .select({ id: schema.receipts.id })
      .from(schema.receipts)
      .where(eq(schema.receipts.sourceMessageId, sourceMessageId))
      .limit(1);
    if (existing) {
      result.duplicates += 1;
      result.skipped += 1;
      continue;
    }

    try {
      const downloaded = await downloadPickedPhoto(item, accessToken);
      console.warn(
        `[photos] downloaded ${item.id}: ${downloaded.bytes.byteLength} bytes, ${downloaded.mimeType}`,
      );
      const parsed = await parseReceipt({
        kind: "image",
        bytes: downloaded.bytes,
        mimeType: downloaded.mimeType,
      });
      if (!parsed.is_receipt) {
        console.warn(
          `[photos] skip ${item.id}: is_receipt=false (vendor=${parsed.vendor ?? "?"}, items=${parsed.items?.length ?? 0})`,
        );
        result.skipped += 1;
        continue;
      }

      const rawInputRef = `${item.mediaFile?.filename ?? item.id} (${downloaded.bytes.byteLength} bytes, ${downloaded.mimeType})`;
      const purchasedAt = resolveReceiptPurchasedDate(parsed.purchased_at, rawInputRef);
      const duplicateReceipt = await findDuplicateParsedReceipt(parsed, purchasedAt);
      if (duplicateReceipt) {
        result.duplicates += 1;
        result.skipped += 1;
        continue;
      }

      const receipt = await persistParsedReceipt({
        parsed,
        source: "google_photos",
        rawInputKind: "image",
        rawInputRef,
        sourceMessageId,
      });
      result.parsed += 1;
      result.receipts.push({
        id: receipt.id,
        vendor: receipt.vendor,
        purchasedAt: receipt.purchasedAt,
        total: receipt.total,
      });
    } catch (error) {
      result.failed += 1;
      console.warn("Google Photos receipt import failed:", error);
    }
  }

  try {
    await photosFetch(`/sessions/${encodeURIComponent(sessionId)}`, accessToken, { method: "DELETE" });
  } catch (error) {
    console.warn("Could not delete Google Photos picker session:", error);
  }

  return result;
}

export async function completeGooglePhotosOAuth(reqUrl: string, code: string) {
  const tokens = await exchangeCodeForGooglePhotosTokens(reqUrl, code);
  const userInfo = await fetchGoogleUserInfo(tokens.access_token ?? "");
  await saveGooglePhotosConnection(tokens, userInfo?.email ?? null);
}
