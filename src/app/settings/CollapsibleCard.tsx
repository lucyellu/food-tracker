"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

// Body stays mounted while collapsed so in-flight work (e.g. an inbox scan) keeps its state.
export function CollapsibleCard({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          {icon}
          {title}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="mt-1">
        {children}
      </div>
    </section>
  );
}
