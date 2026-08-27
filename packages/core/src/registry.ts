import type { ProviderAdapter } from "./adapter.js";
import type { ProviderSlug } from "./types/provider.js";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderSlug, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.slug)) {
      throw new Error(`Provider already registered: ${adapter.slug}`);
    }
    this.adapters.set(adapter.slug, adapter);
  }

  get(slug: ProviderSlug): ProviderAdapter | undefined {
    return this.adapters.get(slug);
  }

  has(slug: ProviderSlug): boolean {
    return this.adapters.has(slug);
  }

  list(): readonly ProviderSlug[] {
    return Array.from(this.adapters.keys());
  }
}
