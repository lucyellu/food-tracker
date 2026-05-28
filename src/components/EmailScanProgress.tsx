type EmailScanProgressProps = {
  label?: string;
  detail?: string;
};

export function EmailScanProgress({
  label = "Scanning inboxes...",
  detail = "Reading messages, attachments, and likely receipt bodies.",
}: EmailScanProgressProps) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex flex-col gap-1 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          {label}
        </span>
        <span>{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-zinc-900 dark:bg-zinc-100" />
      </div>
    </div>
  );
}
