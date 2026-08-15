/**
 * Git provider registry (ADR-0005): providers are registered dynamically and
 * resolved by kind, so adding GitHub/Azure/Bitbucket never touches callers.
 */

import type { GitProvider, GitProviderKind, GitProviderRegistry } from '@ai-review/core';

export class MapGitProviderRegistry implements GitProviderRegistry {
  private readonly providers = new Map<GitProviderKind, GitProvider>();

  register(provider: GitProvider): void {
    this.providers.set(provider.kind, provider);
  }

  get(kind: GitProviderKind): GitProvider | undefined {
    return this.providers.get(kind);
  }
}
