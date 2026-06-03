import { checkLlmProviderConnections } from "@/lib/llm/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = await checkLlmProviderConnections();
  return Response.json({ providers, checkedAt: new Date().toISOString() });
}
