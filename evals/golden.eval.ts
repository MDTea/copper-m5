// The golden-set evaluation (npm run eval, and the "eval" job in GitHub
// Actions): asks the two agents every question in the golden set, has an AI
// judge grade each reply, records the run in Langfuse, and fails if too few
// replies pass.
import { describe, expect, it } from "vitest";
import { ready, runGoldenSet, skipEval } from "@/evals/run-setup";
import { answerWithTwoAgents } from "@/lib/copper/assistant/agents";

/** Share of questions that must pass for the eval to pass. */
const PASS_RATE = Number(process.env.EVAL_PASS_RATE ?? 0.8);

describe.skipIf(skipEval)("golden set", () => {
  it("passes the golden set", async () => {
    expect(
      ready,
      "Set GOOGLE_GENERATIVE_AI_API_KEY and the LANGFUSE_* keys (Actions secrets in CI).",
    ).toBe(true);
    const { passRate } = await runGoldenSet({
      name: "two-agents",
      answer: answerWithTwoAgents,
    });
    expect(passRate).toBeGreaterThanOrEqual(PASS_RATE);
  });
});
