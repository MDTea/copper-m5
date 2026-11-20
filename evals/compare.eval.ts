// One agent vs two agents (npm run eval:compare): runs the same golden set on
// both setups and records each as its own run in Langfuse, to compare side by
// side (Datasets > copper-golden-set > Runs). It doesn't gate anything.
import { describe, expect, it } from "vitest";
import { ready, runGoldenSet, skipEval } from "@/evals/run-setup";
import {
  answerWithOneAgent,
  answerWithTwoAgents,
} from "@/lib/copper/assistant/agents";

describe.skipIf(skipEval)("one agent vs two agents", () => {
  it("runs the golden set on both", async () => {
    expect(ready, "Set the Google and Langfuse keys.").toBe(true);
    const results = [
      await runGoldenSet({ name: "one-agent", answer: answerWithOneAgent }),
      await runGoldenSet({ name: "two-agents", answer: answerWithTwoAgents }),
    ];
    console.info(
      "\nCOMPARISON\n" +
        results
          .map(
            (r) =>
              `${r.name}: ${Math.round(r.passRate * 100)}% passed  ${r.url ?? ""}`,
          )
          .join("\n"),
    );
  });
});
