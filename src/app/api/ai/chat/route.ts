import { chat } from "@/lib/ai-proxy"

export async function POST(request: Request) {
  const body = await request.json()
  return chat(body)
}
