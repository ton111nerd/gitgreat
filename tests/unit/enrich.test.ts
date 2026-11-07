import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { cleanReadme, enrichBatchWithLLM, enrichMany } from "@/lib/server/enrich";

const items = [
  { id: "a/one", description: "LLM agents", topics: ["llm"], language: "Python", readme: "# One\n![badge](x.svg) Builds **agents**." },
  { id: "b/two", description: "Game engine", topics: [], language: "C++", readme: null },
];

function fakeClient(parse: ReturnType<typeof vi.fn>) {
  return { beta: { messages: { parse } } } as unknown as Anthropic;
}

describe("enrichment", () => {
  it("cleans READMEs down to prose", () => {
    expect(cleanReadme(items[0].readme)).toBe("One Builds agents .");
  });

  it("uses structured LLM output, ignores unknown ids and sends the fallback beta", async () => {
    const parse = vi.fn(async () => ({
      stop_reason: "end_turn",
      parsed_output: {
        repos: [
          { id: "a/one", category: "ai", explanation: "Ein Baukasten für KI-Assistenten, die selbstständig Aufgaben erledigen. Vergleichbar mit einem digitalen Praktikanten." },
          { id: "evil/injected", category: "ai", explanation: "Sollte ignoriert werden, weil die id nicht angefragt war." },
        ],
      },
    }));
    const out = await enrichBatchWithLLM(items, fakeClient(parse));
    expect(out.get("a/one")?.source).toBe("llm");
    expect(out.has("evil/injected")).toBe(false);
    expect(out.has("b/two")).toBe(false);
    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.output_config).toMatchObject({ effort: "low" });
  });

  it("returns nothing on refusal", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "refusal", parsed_output: null }));
    expect((await enrichBatchWithLLM(items, fakeClient(parse))).size).toBe(0);
  });

  it("falls back to keywords + description without an API key", async () => {
    const out = await enrichMany(items, { useLLM: false });
    expect(out.get("a/one")).toEqual({ category: "ai", explanation: "LLM agents", source: "keywords" });
    expect(out.get("b/two")?.category).toBe("games");
  });
});
