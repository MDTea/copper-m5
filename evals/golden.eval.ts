// The golden-set evaluation (npm run eval, and the "Eval" job in GitHub
// Actions). It asks the agents every question in the golden set, has an AI
// judge grade each reply, and records the run in Langfuse: one dataset run
// with a trace and scores per question. It fails if too few replies pass.
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";
import { GOLDEN_SET } from "@/evals/golden-set";
import { judge } from "@/evals/judge";
import { isAiConfigured } from "@/lib/ai/call";
import {
  flushTraces,
  langfuseConfigured,
  setupTracing,
} from "@/lib/ai/tracing";
import { answerWithTwoAgents } from "@/lib/copper/assistant/agents";
import { DEFAULT_LIMIT_USD } from "@/lib/copper/orders";

const DATASET = "copper-golden-set";
/** Share of questions that must pass for the eval to pass. */
const PASS_RATE = Number(process.env.EVAL_PASS_RATE ?? 0.8);
const SETUP = "two-agents";
// Stay under Google's free-tier limit of about 15 requests a minute.
process.env.AI_MIN_INTERVAL_MS ??= "4500";

// On your own machine the eval skips itself when the keys aren't set. In
// GitHub Actions (CI is set) a missing key is a failure, so a pull request
// can't pass by skipping the eval.
const ready = isAiConfigured() && langfuseConfigured();

describe.skipIf(!ready && !process.env.CI)("golden set", () => {
  it("passes the golden set", { timeout: 1_200_000 }, async () => {
    expect(
      ready,
      "Set GOOGLE_GENERATIVE_AI_API_KEY and the LANGFUSE_* keys (Actions secrets in CI).",
    ).toBe(true);
    setupTracing();
    const langfuse = new LangfuseClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
    });

    // The golden set lives in Langfuse as a dataset, so every setup
    // (one agent, two agents) is compared on exactly the same questions.
    try {
      await langfuse.api.datasets.create({ name: DATASET });
    } catch {
      // already exists
    }
    for (const c of GOLDEN_SET)
      await langfuse.api.datasetItems.create({
        datasetName: DATASET,
        id: `${DATASET}-${c.id}`,
        input: c.question,
        expectedOutput: c.expected,
        metadata: { id: c.id, category: c.category },
      });

    const dataset = await langfuse.dataset.get(DATASET);
    const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "local";
    const result = await dataset.runExperiment({
      name: `Copper ${SETUP}`,
      runName: `${SETUP}-${sha}-${new Date().toISOString()}`,
      description: "Golden set, graded by an AI judge.",
      metadata: { setup: SETUP, model: process.env.AI_MODEL ?? "default" },
      maxConcurrency: 3,
      task: async ({ input }) =>
        answerWithTwoAgents(String(input), {
          limitUsd: DEFAULT_LIMIT_USD,
          refunds: [],
        }),
      evaluators: [
        async ({ input, output, expectedOutput }) => {
          const v = await judge(
            { question: String(input), expected: String(expectedOutput) },
            output.reply,
          );
          return [
            {
              name: "judge_pass",
              value: v.passed ? 1 : 0,
              comment: v.reason,
            },
            { name: "judge_score", value: v.score, comment: v.reason },
          ];
        },
      ],
      runEvaluators: [
        async ({ itemResults }) => {
          const passes = itemResults.filter((r) =>
            r.evaluations.some((e) => e.name === "judge_pass" && e.value === 1),
          ).length;
          return {
            name: "pass_rate",
            value: passes / GOLDEN_SET.length,
            comment: `${passes} of ${GOLDEN_SET.length} passed (a question that errors counts as a fail)`,
          };
        },
      ],
    });

    await flushTraces();
    await langfuse.flush();
    console.info(await result.format());

    const rate = result.runEvaluations.find((e) => e.name === "pass_rate");
    expect(Number(rate?.value)).toBeGreaterThanOrEqual(PASS_RATE);
  });
});
