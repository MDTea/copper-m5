// Runs once when the server starts. Sends a trace of every AI call to
// Langfuse: each agent, its tool calls, tokens, cost and time. If the Langfuse
// keys aren't in .env.local, nothing is sent and the app works as before.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { setupTracing } = await import("@/lib/ai/tracing");
  setupTracing();
}
