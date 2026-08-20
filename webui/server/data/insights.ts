import "server-only";

import { demoInsights } from "@/server/demo/data";
export async function getPlayerInsights() {
  return demoInsights();
}
