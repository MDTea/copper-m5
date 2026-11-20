// Runs the golden set on one setup of the agents and records it in Langfuse
// as one dataset run: a trace per question, with the AI judge's scores. Used
// by golden.eval.ts (the CI gate) and compare.eval.ts (one agent vs two).
import { LangfuseClient } from "@langfuse/client";
import { GOLDEN_SET } from "@/evals/golden-set";
import { judge } from "@/evals/judge";
import { isAiConfigured } from "@/lib/ai/call";
import {
  flushTraces,
  langfuseConfigured,
  setupTracing,
} from "@/lib/ai/tracing";
import type { AgentAnswer } from "@/lib/copper/assistant/agents";
import { DEFAULT_LIMIT_USD } from "@/lib/copper/orders";

export const DATASET = "copper-golden-set";

// Stay under Google's free-tier limit of about 15 requests a minute.
process.env.AI_MIN_INTERVAL_MS ??= "4500";

// On your own machine the eval skips itself when the keys aren't set. In
// GitHub Actions (CI is set) a missing key is a failure, so a pull request
// can't pass by skipping the eval.
export const ready = isAiConfigured() && langfuseConfigured();
export const skipEval = !ready && !process.env.CI;

export type Setup = {
  /** Shown in Langfuse, e.g. "two-agents". */
  name: string;
  answer: (
    question: string,
    desk: { limitUsd: number; refunds: [] },
  ) => Promise<AgentAnswer>;
};

export type SetupResult = {
  name: string;
  passRate: number;
  url: string | undefined;
};

/** Runs every golden-set question on `setup` and returns its pass rate. */
export async function runGoldenSet(setup: Setup): Promise<SetupResult> {
  setupTracing();
  const langfuse = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });

  // The golden set lives in Langfuse as a dataset, so every setup is
  // compared on exactly the same questions.
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
    name: `Copper ${setup.name}`,
    runName: `${setup.name}-${sha}-${new Date().toISOString()}`,
    description: "Golden set, graded by an AI judge.",
    metadata: { setup: setup.name, model: process.env.AI_MODEL ?? "default" },
    maxConcurrency: 3,
    task: async ({ input }) =>
      setup.answer(String(input), { limitUsd: DEFAULT_LIMIT_USD, refunds: [] }),
    evaluators: [
      async ({ input, output, expectedOutput }) => {
        const v = await judge(
          { question: String(input), expected: String(expectedOutput) },
          output.reply,
        );
        return [
          { name: "judge_pass", value: v.passed ? 1 : 0, comment: v.reason },
          { name: "judge_score", value: v.score, comment: v.reason },
          // Cost, time and effort, so the setups can be compared on more
          // than quality.
          { name: "tokens", value: output.tokens },
          { name: "seconds", value: Math.round(output.seconds * 10) / 10 },
          { name: "tool_calls", value: output.tools.length },
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
  return {
    name: setup.name,
    passRate: Number(rate?.value ?? 0),
    url: result.datasetRunUrl,
  };
}
