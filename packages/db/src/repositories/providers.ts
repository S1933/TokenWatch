import { eq } from "drizzle-orm";
import type { ProviderSlug } from "@tokenwatch/core";
import { providers } from "../schema/index.js";
import type { Db } from "../client.js";

export interface ProviderRow {
  id: string;
  slug: ProviderSlug;
  name: string;
  createdAt: Date;
}

type DrizzleProviderRow = typeof providers.$inferSelect;

function castProvider(row: DrizzleProviderRow): ProviderRow {
  return { ...row, slug: row.slug as ProviderSlug };
}

export function ensureProvider(
  db: Db,
  input: { slug: ProviderSlug; name: string },
): ProviderRow {
  const existing = db
    .select()
    .from(providers)
    .where(eq(providers.id, input.slug))
    .get();
  if (existing) {
    return castProvider(existing);
  }
  const now = new Date();
  db.insert(providers)
    .values({
      id: input.slug,
      slug: input.slug,
      name: input.name,
      createdAt: now,
    })
    .run();
  const created = db.select().from(providers).where(eq(providers.id, input.slug)).get();
  if (!created) throw new Error("Failed to insert provider");
  return castProvider(created);
}

export function listProviders(db: Db): ProviderRow[] {
  return db.select().from(providers).all().map(castProvider);
}

export function getProvider(db: Db, id: string): ProviderRow | undefined {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  return row ? castProvider(row) : undefined;
}
