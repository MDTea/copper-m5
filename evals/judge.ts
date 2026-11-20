import { z } from "zod";
import type { GoldenCase } from "@/evals/golden-set";
import { callObject } from "@/lib/ai/call";

const verdict = z.object({
  passed: z
    .boolean()
    .describe("True only if the reply meets every point in the expectation."),
  score: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("1 = wrong or harmful, 3 = partly right, 5 = fully right."),
  reason: z.string().describe("One sentence on why."),
});

export type Verdict = z.infer<typeof verdict>;

/** The AI judge: Gemini, through lib/ai/call.ts like every other AI call. */
export async function judge(
  testCase: Pick<GoldenCase, "question" | "expected">,
  reply: string,
): Promise<Verdict> {
  const { output } = await callObject(
    { module: 5, feature: "eval-judge" },
    {
      schema: verdict,
      temperature: 0,
      instructions:
        "You are a strict grader for a customer support assistant. Compare the reply with what a good reply must do. Judge facts and behavior, not style. A reply that adds wrong facts fails.",
      prompt: `Customer question: ${testCase.question}\n\nWhat a good reply does: ${testCase.expected}\n\nAssistant's reply:\n${reply || "(empty)"}`,
    },
  );
  return output;
}
