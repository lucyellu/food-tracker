import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  if (!authEnabled()) redirect("/");
  const { error, returnTo } = await searchParams;
  const href = `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-16 text-center">
      <h1 className="font-display text-4xl tracking-tight">Your kitchen</h1>
      <p className="text-ink-soft">This copy is private. Sign in with the Google account that owns it.</p>
      {error && (
        <p className="rounded-xl p-3 text-sm" style={{ background: "var(--tint-snack)", color: "var(--on-tint)" }}>
          {error}
        </p>
      )}
      <a href={href} className="inline-block rounded-full bg-ink px-6 py-3 text-paper">
        Sign in with Google
      </a>
    </div>
  );
}
