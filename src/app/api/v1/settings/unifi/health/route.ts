import { withSession } from "@/server/guard";
import { gatewayHealth } from "@/server/gateway-health";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ health: await gatewayHealth() }));
}
