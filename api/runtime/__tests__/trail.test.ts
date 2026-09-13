import { describe, expect, it } from "vitest";
import { deriveGraph, TRAIL_WEIGHTS, type GraphAgent, type GraphEvent, type GraphMemory } from "../trail";

function at(hour: number): Date {
  return new Date(Date.UTC(2026, 7, 30, hour, 0, 0));
}

function event(patch: Partial<GraphEvent> & Pick<GraphEvent, "id" | "kind">): GraphEvent {
  return {
    weight: TRAIL_WEIGHTS[patch.kind],
    agentId: null,
    landmarkId: null,
    conversationId: null,
    memoryId: null,
    createdAt: at(12),
    ...patch,
  };
}

const diet: GraphAgent = { id: 2, slug: "diet", name: "营养巫师", landmarkId: "coffee" };
const mix: GraphAgent = { id: 6, slug: "mixology", name: "调酒师", landmarkId: "livehouse" };

const allergy: GraphMemory = {
  id: 10,
  key: "restriction:shellfish",
  topics: "diet,health",
  level: "L1",
  sourceConversationId: 1,
};
const insight: GraphMemory = {
  id: 11,
  key: "insight:tea",
  topics: "diet",
  level: "L2",
  sourceConversationId: 1,
};

describe("deriveGraph", () => {
  it("sizes landmark and agent nodes by event weight", () => {
    const { nodes } = deriveGraph(
      [
        event({ id: 1, kind: "open_landmark", landmarkId: "coffee" }),
        event({ id: 2, kind: "open_chat", agentId: 2, landmarkId: "coffee", conversationId: 1 }),
      ],
      [],
      [diet],
    );
    const landmark = nodes.find((n) => n.id === "landmark:coffee");
    const agent = nodes.find((n) => n.id === "agent:2");
    expect(landmark?.weight).toBe(1 + 2);
    expect(agent?.weight).toBe(2);
    expect(landmark?.eventIds).toEqual([1, 2]);
  });

  it("builds keyword and topic nodes from user memories, not agent craft", () => {
    const { nodes } = deriveGraph(
      [event({ id: 3, kind: "memory_l1", memoryId: 10, agentId: 2, conversationId: 1 })],
      [allergy],
      [diet],
    );
    expect(nodes.some((n) => n.id === "keyword:restriction")).toBe(true);
    expect(nodes.some((n) => n.id === "topic:diet")).toBe(true);
    expect(nodes.some((n) => n.id === "topic:health")).toBe(true);
    expect(nodes.every((n) => n.type !== "keyword" || n.label !== "craft")).toBe(true);
  });

  it("links nodes that share a conversation or a landmark", () => {
    const { edges } = deriveGraph(
      [
        event({ id: 1, kind: "open_chat", agentId: 2, conversationId: 1, landmarkId: "coffee" }),
        event({ id: 2, kind: "memory_l2", memoryId: 11, agentId: 2, conversationId: 1, landmarkId: "coffee" }),
      ],
      [insight],
      [diet],
    );
    expect(edges.some((e) => e.kind === "same_conversation")).toBe(true);
    expect(edges.some((e) => e.kind === "same_place")).toBe(true);
  });

  it("adds a temporal edge when two landmarks are visited within 24 hours", () => {
    const { edges } = deriveGraph(
      [
        event({ id: 1, kind: "open_landmark", landmarkId: "coffee", createdAt: at(10) }),
        event({ id: 2, kind: "open_landmark", landmarkId: "livehouse", createdAt: at(18) }),
      ],
      [],
      [],
    );
    expect(
      edges.some(
        (e) =>
          e.kind === "temporal" &&
          e.from === "landmark:coffee" &&
          e.to === "landmark:livehouse",
      ),
    ).toBe(true);
  });

  it("does not add a temporal edge across more than 24 hours", () => {
    const { edges } = deriveGraph(
      [
        event({ id: 1, kind: "open_landmark", landmarkId: "coffee", createdAt: at(0) }),
        event({
          id: 2,
          kind: "open_landmark",
          landmarkId: "livehouse",
          createdAt: new Date(Date.UTC(2026, 7, 31, 1, 0, 0)),
        }),
      ],
      [],
      [],
    );
    expect(edges.some((e) => e.kind === "temporal")).toBe(false);
  });

  it("marks a keyword promoted when L2 and L1 both exist, without a second node", () => {
    const twin: GraphMemory = { ...allergy, id: 12, level: "L2" };
    const { nodes, edges } = deriveGraph(
      [
        event({ id: 1, kind: "memory_l2", memoryId: 12, conversationId: 1 }),
        event({ id: 2, kind: "memory_l1", memoryId: 10, conversationId: 1 }),
      ],
      [allergy, twin],
      [diet],
    );
    const keywords = nodes.filter((n) => n.type === "keyword");
    expect(keywords).toHaveLength(1);
    expect(keywords[0]?.promoted).toBe(true);
    expect(edges.some((e) => e.kind === "promotion")).toBe(false);
  });

  it("fills a missing landmark from the agent's home", () => {
    const { nodes } = deriveGraph(
      [event({ id: 1, kind: "chat_turn", agentId: 6, conversationId: 9 })],
      [],
      [mix],
    );
    expect(nodes.some((n) => n.id === "landmark:livehouse")).toBe(true);
  });
});
