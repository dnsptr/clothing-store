import { getStatus } from "@/lib/ai-proxy"

export async function GET() {
  return Response.json(getStatus())
}
