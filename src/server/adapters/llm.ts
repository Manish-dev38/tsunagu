export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "done" };

export interface LlmPort {
  streamChat(req: { messages: LlmMessage[]; tools: ToolSpec[] }): AsyncGenerator<LlmEvent>;
}

export interface ScriptedResponse {
  text?: string;
  toolCalls?: { name: string; arguments?: Record<string, unknown> }[];
}

// Scripted OpenAI-compatible tool-call sequences, so agent-loop tests are
// deterministic: no live model, no network.
export class LlmFake implements LlmPort {
  requests: { messages: LlmMessage[]; tools: string[] }[] = [];
  private queue: ScriptedResponse[] = [];

  script(...responses: ScriptedResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  async *streamChat(req: { messages: LlmMessage[]; tools: ToolSpec[] }): AsyncGenerator<LlmEvent> {
    this.requests.push({ messages: req.messages, tools: req.tools.map((t) => t.name) });
    const next = this.queue.shift();
    if (!next) throw new Error("LlmFake: no scripted response left for this turn");
    if (next.text) yield { type: "text_delta", text: next.text };
    for (const [i, call] of (next.toolCalls ?? []).entries()) {
      yield {
        type: "tool_call",
        id: `call_${this.requests.length}_${i}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments ?? {}),
      };
    }
    yield { type: "done" };
  }
}
