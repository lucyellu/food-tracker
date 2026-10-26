import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionHeader({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl tracking-tight sm:text-3xl">{title}</h2>
        {note && <p className="label-mono mt-1 text-ink-faint">{note}</p>}
      </div>
      {action && (
        <Link href={action.href} className="label-mono flex shrink-0 items-center gap-1.5 text-ink-soft hover:text-ink">
          {action.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
