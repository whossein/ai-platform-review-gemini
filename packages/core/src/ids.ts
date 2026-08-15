/**
 * Branded identifier types.
 *
 * We use nominal (branded) types so that, e.g., a `ReviewId` can never be
 * accidentally passed where an `AgentId` is expected — caught at compile time,
 * with zero runtime cost. Contracts only; construction helpers live in `shared`.
 */

declare const brand: unique symbol;

/** A nominal type built on top of a primitive `T`. */
export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type ReviewId = Branded<string, 'ReviewId'>;
export type SnapshotId = Branded<string, 'SnapshotId'>;
export type AgentId = Branded<string, 'AgentId'>;
export type SkillId = Branded<string, 'SkillId'>;
export type ToolId = Branded<string, 'ToolId'>;
export type WorkflowId = Branded<string, 'WorkflowId'>;
export type StageId = Branded<string, 'StageId'>;
export type IssueId = Branded<string, 'IssueId'>;
export type ContextHandle = Branded<string, 'ContextHandle'>;
export type CacheKey = Branded<string, 'CacheKey'>;
export type ProviderId = Branded<string, 'ProviderId'>;
export type ModelId = Branded<string, 'ModelId'>;
export type PromptId = Branded<string, 'PromptId'>;
export type RepositoryId = Branded<string, 'RepositoryId'>;
export type OrganizationId = Branded<string, 'OrganizationId'>;
export type SessionId = Branded<string, 'SessionId'>;

/** A content hash (e.g., sha256 hex). Used pervasively for content-addressed caching. */
export type ContentHash = Branded<string, 'ContentHash'>;

/** ISO-8601 timestamp string. */
export type IsoTimestamp = Branded<string, 'IsoTimestamp'>;
