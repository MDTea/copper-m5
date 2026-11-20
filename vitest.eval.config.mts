import { defineConfig } from "vitest/config";

// The golden-set evaluation reads the same .env.local as the app. (Next's own
// loader skips .env.local when NODE_ENV=test, which Vitest sets.) In GitHub
// Actions there is no file: the keys come from Actions secrets.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 1_200_000,
  },
});
