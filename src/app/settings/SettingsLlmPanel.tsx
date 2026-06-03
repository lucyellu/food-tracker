import { getLlmProviderStatuses, llmTextOrder } from "@/lib/llm/status";
import { SettingsLlmConnectionPanel } from "./SettingsLlmConnectionPanel";

export function SettingsLlmPanel() {
  return (
    <SettingsLlmConnectionPanel
      initialProviders={getLlmProviderStatuses()}
      textOrder={llmTextOrder()}
    />
  );
}
