import {
  CodexUnsupportedAdapter,
  OpenCodeGoAdapter,
  OpenRouterAdapter,
  ClaudeCodeAdapter,
  ProviderRegistry,
} from "@tokenwatch/core";

export interface RegistryDeps {
  keychainResolver: (ref: string) => Promise<string>;
  credentialsFileReader: (path: string) => Promise<unknown>;
}

export function buildRegistry(deps: RegistryDeps): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new OpenRouterAdapter({ keychainResolver: deps.keychainResolver }));
  registry.register(new OpenCodeGoAdapter({ keychainResolver: deps.keychainResolver }));
  registry.register(
    new ClaudeCodeAdapter({ credentialsFileReader: deps.credentialsFileReader }),
  );
  registry.register(new CodexUnsupportedAdapter());
  return registry;
}
