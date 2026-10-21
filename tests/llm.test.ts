import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompat } from "@/server/llm";

const encoder = new TextEncoder();

// Stubs fetch with an SSE body split across the given parts, so buffering and
// mid-line chunk boundaries are exercised the way real network reads are.
function stubSse(parts: string[], init: { status?: number; errorText?: string } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn(async () => ({
    ok: status === 200,
    status,
    text: async () => init.errorText ?? "",
    body:
      status === 200
        ? {
            async *[Symbol.asyncIterator]() {
              for (const part of parts) yield encoder.encode(part);
            },
          }
        : undefined,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const TOOLS = [
  {
    name: "list_emails",
    description: "list",
    parameters: { type: "object", properties: {} },
  },
];

describe("OpenAiCompat SSE streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields text deltas and reassembles fragmented tool calls across chunk boundaries", async () => {
    const fetchMock = stubSse([
      'data: {"choices":[{"delta":{"content":"Hel',
      '"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_emails","arguments":"{\\"que',
      'ry\\":\\"x\\"}"}}]}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const llm = new OpenAiCompat({
      baseUrl: "https://llm.test/v1",
      apiKey: "key123",
      model: "agnes-3-flash",
    });

    const events = [];
    for await (const event of llm.streamChat({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "tool_call", id: "call_1", name: "list_emails", arguments: '{"query":"x"}' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key123" }),
      }),
    );
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    const body = JSON.parse(init.body) as {
      model: string;
      stream: boolean;
      messages: unknown[];
      tools: { type: string; function: { name: string } }[];
    };
    expect(body.model).toBe("agnes-3-flash");
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "list_emails", description: "list", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("flushes tool calls at stream end when the proxy omits finish_reason", async () => {
    stubSse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","function":{"name":"read_email","arguments":"{}"}}]}}]}\n\n',
    ]);
    const llm = new OpenAiCompat({ baseUrl: "https://llm.test/v1/", apiKey: "k", model: "m" });

    const events = [];
    for await (const event of llm.streamChat({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "tool_call", id: "c9", name: "read_email", arguments: "{}" },
    ]);
  });

  it("throws with the status when the endpoint rejects", async () => {
    stubSse([], { status: 401, errorText: "bad key" });
    const llm = new OpenAiCompat({ baseUrl: "https://llm.test/v1", apiKey: "k", model: "m" });

    const iterator = llm.streamChat({
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
    });
    await expect(iterator.next()).rejects.toThrow("LLM request failed: 401 bad key");
  });
});
