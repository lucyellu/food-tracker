"use client";

import { Palette } from "lucide-react";
import { AppearanceControls } from "@/components/AppearanceControls";
import { CollapsibleCard } from "./CollapsibleCard";

export function SettingsAppearancePanel() {
  return (
    <CollapsibleCard title="Appearance" icon={<Palette className="size-4" />} defaultOpen={false}>
      <p className="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Also available from the palette button on every page, which docks beside the page so you can watch it change.
      </p>
      <AppearanceControls />
    </CollapsibleCard>
  );
}
