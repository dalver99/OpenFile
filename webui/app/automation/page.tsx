import AutomationSettings from "@/features/automation/AutomationSettings";
import { runtimeSettings } from "@/server/data/settings";
import { isDemoMode } from "@/server/demo-mode";
import { language, messages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const text = messages[language((await runtimeSettings()).language)].automation;
  return <AutomationSettings text={text} demo={isDemoMode()} />;
}
