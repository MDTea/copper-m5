import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

// Observability: every AI SDK call emits OpenTelemetry spans, and Langfuse
// receives them (model, input, output, tokens, cost, time, tool calls).

export function langfuseConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
    process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}

let processor: LangfuseSpanProcessor | undefined;

/** Starts sending traces to Langfuse. Safe to call more than once. */
export function setupTracing(): void {
  if (processor || !langfuseConfigured()) return;
  processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  registerTelemetry(new OpenTelemetry());
}

/** Sends any traces still waiting. Call before a script or serverless call ends. */
export async function flushTraces(): Promise<void> {
  await processor?.forceFlush();
}
