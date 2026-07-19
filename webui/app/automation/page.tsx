import AutomationSettings from "@/features/automation/AutomationSettings";
import { localConfig } from "@/server/database/config";
import { language, messages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export default function AutomationPage() {
  const text = messages[language(localConfig().language)].automation;
  return <AutomationSettings text={text} />;
}
