"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "text" | "email" | "image";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    try {
      let res: Response;
      if (mode === "image") {
        if (!file) {
          setError("Please choose an image or PDF first.");
          setLoading(false);
          return;
        }
        const form = new FormData();
        form.append("file", file);
        res = await fetch("/api/parse-receipt", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } else {
        if (!text.trim()) {
          setError(mode === "email" ? "Paste the email body first." : "Paste receipt text first.");
          setLoading(false);
          return;
        }
        res = await fetch("/api/parse-receipt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: mode, text }),
          signal: controller.signal,
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed: ${res.status}`);
        setLoading(false);
        return;
      }
      router.push(`/receipts/${data.receiptId}`);
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        setError(
          "Parse took longer than 2 minutes and was cancelled. Try a shorter receipt, an image instead of pasted text, or check the dev server console for the actual error.",
        );
      } else {
        setError(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a receipt</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Paste receipt text, upload a photo, or paste a forwarded email body. Each item gets
          parsed and saved.
        </p>
      </div>

      <div className="flex gap-2">
        {(["text", "image", "email"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
              mode === m
                ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            {m === "text" ? "Paste text" : m === "image" ? "Upload photo/PDF" : "Paste email"}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        {mode === "image" ? (
          <div
            className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-md p-8 text-center cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown"}
                </p>
                <button
                  type="button"
                  className="text-xs text-blue-600 mt-2 underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="text-zinc-500">
                <p>Drop a receipt photo or PDF here</p>
                <p className="text-xs mt-1">or click to choose</p>
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === "email"
                ? "Paste the full forwarded email body (with headers OK — we strip them)"
                : "Paste raw receipt text here. Each item on its own line is ideal."
            }
            rows={14}
            className="w-full bg-transparent text-sm font-mono outline-none resize-y"
          />
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Parsing…" : "Parse receipt"}
        </button>
        {loading && (
          <span className="text-sm text-zinc-500">This takes ~5–15s depending on input size.</span>
        )}
      </div>
    </div>
  );
}
