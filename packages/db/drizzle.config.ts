import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["TOKENWATCH_DB"] ?? "./data/tokenwatch.db",
  },
  verbose: true,
  strict: true,
});
