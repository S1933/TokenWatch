import { z } from "zod";

export const ProviderSlugSchema = z.enum([
  "opencode-go",
  "openrouter",
  "claude-code",
  "codex",
]);

const ApiKeyRequestSchema = z.object({
  kind: z.literal("api_key"),
  secret: z.string().min(1).max(4096),
});

const OAuthFileRequestSchema = z.object({
  kind: z.literal("oauth_file"),
  path: z.string().min(1),
});

const OAuthCookieRequestSchema = z.object({
  kind: z.literal("oauth_cookie"),
  cookieRef: z.string().min(1),
  workspaceId: z.string().min(1),
});

const ManualRequestSchema = z.object({
  kind: z.literal("manual"),
});

export const CredentialsRequestSchema = z.discriminatedUnion("kind", [
  ApiKeyRequestSchema,
  OAuthFileRequestSchema,
  OAuthCookieRequestSchema,
  ManualRequestSchema,
]);

export const CreateAccountBodySchema = z.object({
  providerId: ProviderSlugSchema,
  name: z.string().min(1).max(64),
  credentials: CredentialsRequestSchema,
});

export const CreditWindowSchema = z.object({
  type: z.enum(["5h", "daily", "weekly", "monthly"]),
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  unit: z.enum(["credits", "usd", "percent", "tokens", "messages"]),
  resetAt: z.string().nullable(),
});

export const CreditSnapshotSchema = z.object({
  accountId: z.string(),
  fetchedAt: z.string(),
  windows: z.array(CreditWindowSchema),
});

export const AccountStatusSchema = z.enum([
  "healthy",
  "warning",
  "error",
  "unsupported",
  "manual",
]);
