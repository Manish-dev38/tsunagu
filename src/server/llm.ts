import type { LlmEvent, LlmMessage, LlmPort, ToolSpec } from "@/server/adapters/llm";

interface OpenAiCompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface SseChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

export class OpenAiCompat implements LlmPort {
  constructor(private readonly config: OpenAiCompatConfig) {}

  async *streamChat(req: { messages: LlmMessage[]; tools: ToolSpec[] }): AsyncGenerator<LlmEvent> {
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: req.messages.map(toOpenAiMessage),
        tools: req.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM request failed: ${res.status} ${detail}`.slice(0, 500));
    }

    const decoder = new TextDecoder();
    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let parsed: SseChunk;
        try {
          parsed = JSON.parse(data) as SseChunk;
        } catch {
          continue;
        }
        const choice = parsed.choices?.[0];
        if (choice?.delta?.content) yield { type: "text_delta", text: choice.delta.content };
        for (const fragment of choice?.delta?.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const current = pendingCalls.get(index) ?? { id: "", name: "", arguments: "" };
          if (fragment.id) current.id = fragment.id;
          if (fragment.function?.name) current.name = fragment.function.name;
          if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
          pendingCalls.set(index, current);
        }
        // tool-call arguments stream in fragments; they are complete at finish
        if (choice?.finish_reason === "tool_calls") {
          yield* flushToolCalls(pendingCalls);
        }
      }
    }
    // some OpenAI-compatible proxies omit finish_reason; flush whatever completed
    yield* flushToolCalls(pendingCalls);
  }
}

function flushToolCalls(
  calls: Map<number, { id: string; name: string; arguments: string }>,
): LlmEvent[] {
  const events: LlmEvent[] = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      type: "tool_call" as const,
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments,
    }));
  calls.clear();
  return events;
}

function toOpenAiMessage(m: LlmMessage) {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.toolCalls?.length ? null : m.content,
      tool_calls: m.toolCalls?.length
        ? m.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          }))
        : undefined,
    };
  }
  return { role: m.role, content: m.content };
}

let instance: LlmPort | undefined;

// Lazily configured so non-chat routes keep working without OPENAI_* env.
export const openAiLlm: LlmPort = {
  streamChat(req) {
    if (!instance) {
      const baseUrl = process.env.OPENAI_BASE_URL;
      const apiKey = process.env.OPENAI_API_KEY;
      if (!baseUrl || !apiKey) {
        throw new Error(
          "LLM is not configured: set OPENAI_BASE_URL and OPENAI_API_KEY (OPENAI_MODEL defaults to agnes-3-flash)",
        );
      }
      instance = new OpenAiCompat({
        baseUrl,
        apiKey,
        model: process.env.OPENAI_MODEL || "agnes-3-flash",
      });
    }
    return instance.streamChat(req);
  },
};
