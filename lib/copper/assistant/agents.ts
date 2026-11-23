// The two agents' calls, shared by the Ask Copper chat (ask.ts, which streams
// them to the panel) and the golden-set evaluation (evals/, which reads the
// finished answer).
import { startActiveObservation } from "@langfuse/tracing";
import { hasToolCall, stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { defaultModel } from "@/lib/ai/models";
import { costUsd } from "@/lib/ai/pricing";
import type { ChatMessage } from "@/lib/copper/assistant/ask";
import {
  COPPER_HANDOFF,
  COPPER_INSTRUCTIONS,
  REFUND_AGENT_INSTRUCTIONS,
  SINGLE_AGENT_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import type { Agent } from "@/lib/copper/assistant/progress";
import {
  copperTools,
  refundAgentTools,
  transferToRefundAgent,
} from "@/lib/copper/assistant/tools";
import type { Desk } from "@/lib/copper/orders";

/** At most this many model steps (tool calls plus the reply) per agent. */
const MAX_STEPS = 5;

/** Copper → Refund agent → Copper at most, so a turn can't bounce forever. */
export const MAX_HANDOFFS = 2;

export const HANDOFF_TOOLS: Record<string, Agent> = {
  transfer_to_refund_agent: "refund",
  transfer_to_copper: "copper",
};

// A handoff ends the agent's turn: the other agent answers.
const STOP = [
  stepCountIs(MAX_STEPS),
  hasToolCall("transfer_to_refund_agent", "transfer_to_copper"),
];

/** One agent's call: its instructions and only its own tools. */
export function agentCall(agent: Agent, messages: ChatMessage[], desk?: Desk) {
  if (agent === "refund" && desk)
    return callStream(
      { module: 4, feature: "refund-agent" },
      {
        messages,
        providerOptions: THOUGHT_SUMMARIES,
        instructions: REFUND_AGENT_INSTRUCTIONS,
        tools: refundAgentTools(desk),
        stopWhen: STOP,
      },
    );
  return callStream(
    { module: 2, feature: "ask-copper" },
    {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      instructions: desk
        ? `${COPPER_INSTRUCTIONS}\n\n${COPPER_HANDOFF}`
        : COPPER_INSTRUCTIONS,
      tools: desk
        ? { ...copperTools, transfer_to_refund_agent: transferToRefundAgent }
        : copperTools,
      stopWhen: STOP,
    },
  );
}

export type AgentAnswer = {
  reply: string;
  /** Which agents spoke, in order, e.g. ["copper", "refund"]. */
  agents: Agent[];
  /** Every tool called, in order, e.g. ["transfer_to_refund_agent", "request_refund"]. */
  tools: string[];
  /** Model tokens used across every call, and how long the answer took. */
  tokens: number;
  costUsd: number;
  seconds: number;
};

type Usage = { inputTokens?: number; outputTokens?: number };

/** What one call cost, from the tokens it used and the model's list price. */
const costOf = (usage: Usage) =>
  costUsd(defaultModel(), usage.inputTokens ?? 0, usage.outputTokens ?? 0);

/**
 * Asks the two agents one question and waits for the finished answer (no
 * streaming): Copper answers, or hands over to the Refund agent and back.
 */
export async function answerWithTwoAgents(
  question: string,
  desk: Desk,
): Promise<AgentAnswer> {
  const started = performance.now();
  const messages: ChatMessage[] = [{ role: "user", content: question }];
  const answer: AgentAnswer = {
    reply: "",
    agents: [],
    tools: [],
    tokens: 0,
    costUsd: 0,
    seconds: 0,
  };
  let current: Agent = "copper";
  for (let handoffs = 0; ; handoffs++) {
    const agent: Agent = current;
    // Each agent's turn is its own named span in Langfuse.
    const next: Agent | undefined = await startActiveObservation(
      `${agent}-agent`,
      async () => {
        const result = agentCall(agent, messages, desk);
        answer.reply = await result.text;
        answer.agents.push(agent);
        const usage = await result.totalUsage;
        answer.tokens += usage.totalTokens ?? 0;
        answer.costUsd += costOf(usage);
        let handoff: Agent | undefined;
        for (const step of await result.steps)
          for (const call of step.toolCalls) {
            answer.tools.push(call.toolName);
            if (call.toolName in HANDOFF_TOOLS)
              handoff = HANDOFF_TOOLS[call.toolName];
          }
        return handoff;
      },
      { asType: "agent" },
    );
    if (!next || next === current || handoffs >= MAX_HANDOFFS) break;
    current = next;
    answer.reply = "";
  }
  answer.seconds = (performance.now() - started) / 1000;
  return answer;
}

/**
 * The comparison setup: one agent with every tool (Copper's and the Refund
 * agent's) and no handoff. Same question, same desk, same finished answer.
 */
export async function answerWithOneAgent(
  question: string,
  desk: Desk,
): Promise<AgentAnswer> {
  const started = performance.now();
  const result = callStream(
    { module: 5, feature: "single-agent" },
    {
      messages: [{ role: "user", content: question }],
      providerOptions: THOUGHT_SUMMARIES,
      instructions: SINGLE_AGENT_INSTRUCTIONS,
      tools: { ...copperTools, ...singleAgentRefundTools(desk) },
      stopWhen: stepCountIs(MAX_STEPS),
    },
  );
  const reply = await result.text;
  const tools = (await result.steps).flatMap((step) =>
    step.toolCalls.map((call) => call.toolName),
  );
  const usage = await result.totalUsage;
  return {
    reply,
    agents: ["copper"],
    tools,
    tokens: usage.totalTokens ?? 0,
    costUsd: costOf(usage),
    seconds: (performance.now() - started) / 1000,
  };
}

/** The refund tools without the handoff back to Copper. */
function singleAgentRefundTools(desk: Desk) {
  const { get_orders, request_refund } = refundAgentTools(desk);
  return { get_orders, request_refund };
}
