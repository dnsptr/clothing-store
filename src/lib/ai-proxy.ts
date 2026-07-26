const KEYS = [
  "sk-0afedcef5ca74c099c12b047fad0324e",
  "sk-9bf124f946124600b9d70824998dc2a2",
  "sk-0072906e91dd41b4a21c8dccc5bc9615",
  "sk-7e0ae19c53764a848196ee28b3c31c3a",
  "sk-228aba31db7a45c2891b8214e164f459",
  "sk-a144d606f37245d486e7ed61cd53c2fe",
  "sk-b7085211c57b474e838936c8e6381b2b",
  "sk-0f3bbd5fe9854280a3c4ee93a4c6004a",
  "sk-a4c438c733554ba7945011fb7056fb38",
  "sk-35a9d91648fa40b6b8b6dc7aec566ea2",
  "sk-1c6adcc49ca54e13bc5aa6a10d4d435e",
  "sk-4975299df0254aac9587e0d8bc78f978",
  "sk-6d6b7b8eac764d08b90a817610f2f6ce",
  "sk-3d3ca66a82a448da83e51da041c4e159",
  "sk-ff0571b1b8054f26a1758a641b5921b9",
  "sk-12e257074ba9419a991cc497de3f18dd",
  "sk-73d3b31261784180be3835215500ce09",
  "sk-f1e4a538f6f846fd8a61b5c4fbae7c98",
]

let currentIndex = 0
let failedKeys = new Set<number>()

function getNextKey(): { key: string; index: number } | null {
  const attempts = KEYS.length
  for (let i = 0; i < attempts; i++) {
    const idx = (currentIndex + i) % KEYS.length
    if (!failedKeys.has(idx)) {
      currentIndex = (idx + 1) % KEYS.length
      return { key: KEYS[idx], index: idx }
    }
  }
  return null
}

function markFailed(index: number) {
  failedKeys.add(index)
  console.warn(`[ai-proxy] Key #${index} marked as failed (${failedKeys.size}/${KEYS.length} dead)`)
}

function markAlive(index: number) {
  failedKeys.delete(index)
}

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"

interface Message {
  role: "user" | "assistant" | "system"
  content: string
}

interface ChatRequest {
  model?: string
  messages: Message[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

function toDashscopeBody(req: ChatRequest) {
  return {
    model: req.model || "glm-5.2",
    input: { messages: req.messages },
    parameters: {
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      ...(req.stream !== undefined && { stream: req.stream }),
      result_format: "message",
    },
  }
}

function fromDashscopeResponse(body: any) {
  const choice = body.output?.choices?.[0]
  return {
    id: body.request_id,
    object: "chat.completion",
    created: Date.now(),
    model: body.output?.model || "glm-5.2",
    choices: [
      {
        index: 0,
        message: {
          role: choice?.message?.role || "assistant",
          content: choice?.message?.content || "",
        },
        finish_reason: choice?.finish_reason || "stop",
      },
    ],
    usage: body.usage || {},
  }
}

export async function chat(req: ChatRequest): Promise<Response> {
  const controller = new AbortController()

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const entry = getNextKey()
    if (!entry) {
      return new Response(
        JSON.stringify({ error: "All API keys have been exhausted" }),
        { status: 503, headers: { "content-type": "application/json" } }
      )
    }

    const { key, index } = entry
    const dashscopeBody = toDashscopeBody(req)

    try {
      const res = await fetch(DASHSCOPE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dashscopeBody),
        signal: controller.signal,
      })

      if (res.ok) {
        markAlive(index)
        const data = await res.json()
        const openaiCompatible = fromDashscopeResponse(data)
        return new Response(JSON.stringify(openaiCompatible), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }

      if (res.status === 429 || res.status === 400 || res.status === 401 || res.status === 403) {
        markFailed(index)
        continue
      }

      const errBody = await res.text()
      return new Response(
        JSON.stringify({ error: `Upstream error ${res.status}`, detail: errBody }),
        { status: res.status, headers: { "content-type": "application/json" } }
      )
    } catch (err: any) {
      if (err.name === "AbortError") throw err
      markFailed(index)
    }
  }

  return new Response(
    JSON.stringify({ error: "All API keys exhausted after retries" }),
    { status: 503, headers: { "content-type": "application/json" } }
  )
}

export function getStatus() {
  return {
    total: KEYS.length,
    alive: KEYS.length - failedKeys.size,
    dead: failedKeys.size,
    aliveKeys: KEYS.filter((_, i) => !failedKeys.has(i)),
  }
}
