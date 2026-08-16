/**
 * First-party specialist agents (composition root).
 *
 * Each specialist shares one behavior: ask the LLM (behind the provider-agnostic
 * client) for structured findings scoped to its category, then map the JSON into
 * the canonical `Issue` shape with provenance + a stable fingerprint. This proves
 * the "structured output only" rule (ADR-0008) end-to-end.
 *
 * In a full build these would live in a `plugins/reviewers` package and be
 * registered via the plugin contract; here they are wired directly so the CLI
 * runs a real review today.
 */

import type {
  AgentDefinition,
  AgentHandler,
  AgentId,
  AgentResult,
  ContentHash,
  Issue,
  IssueId,
  ModelId,
  ModelTier,
  Severity,
  SkillId,
  ToolId,
} from '@ai-review/core';

/** Shape the mock/real model returns as JSON content. */
interface RawFinding {
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestion: string;
  readonly file: string;
  readonly line: number;
  readonly category: string;
}

const VALID_SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Coerces whatever severity string a real model emits (e.g. "bug", "style/layout") into the canonical `Severity` union, defaulting to 'medium'. */
function normalizeSeverity(value: unknown): Severity {
  const s = String(value ?? '').toLowerCase();
  return (VALID_SEVERITIES as readonly string[]).includes(s) ? (s as Severity) : 'medium';
}

/** Coerces a line reference into a single line number. Models sometimes report a range ("13-17") or a non-numeric value; take the first number found, defaulting to 1. */
function normalizeLine(value: unknown): number {
  const match = /\d+/.exec(String(value ?? ''));
  return match ? Number(match[0]) : 1;
}

/** Common language codes/names mapped to the label the LLM prompt uses. Anything not listed is passed through as-is, so any language name works. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  fa: 'Persian (Farsi)',
  farsi: 'Persian (Farsi)',
  persian: 'Persian (Farsi)',
  en: 'English',
  english: 'English',
  ar: 'Arabic',
  arabic: 'Arabic',
  tr: 'Turkish',
  turkish: 'Turkish',
  fr: 'French',
  french: 'French',
  de: 'German',
  german: 'German',
  es: 'Spanish',
  spanish: 'Spanish',
  ru: 'Russian',
  russian: 'Russian',
  zh: 'Chinese',
  chinese: 'Chinese',
};

/**
 * Resolves the language specialists should write review comments in.
 * `AI_REVIEW_COMMENT_LANGUAGE` — env var, defaults to Persian (Farsi).
 * Accepts a short code (`fa`, `en`, ...) or a free-text language name; unknown
 * values are passed straight through to the prompt so any language works.
 */
export function resolveCommentLanguage(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = (env['AI_REVIEW_COMMENT_LANGUAGE'] ?? 'fa').trim();
  return LANGUAGE_NAMES[raw.toLowerCase()] ?? raw;
}

/** Tiny stable fingerprint (FNV-1a) — good enough for snapshot diffing here. */
function fingerprint(parts: readonly string[]): ContentHash {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') as ContentHash;
}

/** A specialist agent's static config. */
export interface SpecialistSpec {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  /** The category the mock provider keys on (`FOCUS:<category>`). */
  readonly focus: string;
  readonly priority: number;
  readonly preferredTier?: ModelTier;
}

export const SPECIALISTS: readonly SpecialistSpec[] = [
  { id: 'agent.react-reviewer', name: 'React Reviewer', goal: 'React correctness & idioms', focus: 'react', priority: 60, preferredTier: 'mid' },
  { id: 'agent.dotnet-reviewer', name: '.NET Core & C# Reviewer', goal: '.NET idioms & async', focus: 'dotnet, csharp', priority: 60, preferredTier: 'mid' },
  { id: 'agent.python-reviewer', name: 'Python Reviewer', goal: 'PEP-8 & idioms', focus: 'python', priority: 60, preferredTier: 'mid' },
  { id: 'agent.android-reviewer', name: 'Android Reviewer', goal: 'Kotlin/Java memory leaks & UI', focus: 'android', priority: 60, preferredTier: 'mid' },
  { id: 'agent.ios-reviewer', name: 'iOS Reviewer', goal: 'Swift/Obj-C memory & SwiftUI', focus: 'ios', priority: 60, preferredTier: 'mid' },
  { id: 'agent.nextjs-reviewer', name: 'Next.js Reviewer', goal: 'App/Pages router & SSR', focus: 'nextjs', priority: 60, preferredTier: 'mid' },
  { id: 'agent.angular-reviewer', name: 'Angular Reviewer', goal: 'RxJS memory leaks & ChangeDetection', focus: 'angular', priority: 60, preferredTier: 'mid' },
  { id: 'agent.vue-reviewer', name: 'Vue.js Reviewer', goal: 'Composition API & reactivity', focus: 'vuejs', priority: 60, preferredTier: 'mid' },
  { id: 'agent.typescript-reviewer', name: 'TypeScript Reviewer', goal: 'Type safety & advanced types', focus: 'typescript', priority: 60, preferredTier: 'mid' },
  { id: 'agent.react-native-reviewer', name: 'React Native Reviewer', goal: 'Bridge performance & UI', focus: 'react-native', priority: 60, preferredTier: 'mid' },
  { id: 'agent.security-reviewer', name: 'Security Reviewer', goal: 'Security vulnerabilities', focus: 'security', priority: 90, preferredTier: 'premium' },
  { id: 'agent.performance-reviewer', name: 'Performance Reviewer', goal: 'Performance issues', focus: 'performance', priority: 50, preferredTier: 'mid' },
  { id: 'agent.code-reviewer', name: 'Code Reviewer', goal: 'General code quality', focus: 'code', priority: 40, preferredTier: 'cheap' },
];

export function makeSpecialistDefinition(spec: SpecialistSpec, env?: Record<string, string>): AgentDefinition {
  const language = resolveCommentLanguage(env);
  return {
    id: spec.id as AgentId,
    name: spec.name,
    goal: spec.goal,
    description: `${spec.name}: reviews changed lines for ${spec.focus} issues.`,
    // The system prompt carries the FOCUS marker the model keys on, plus the
    // strict-JSON instruction required by ADR-0008.
    systemPrompt: `You are the ${spec.name}. FOCUS:${spec.focus}. Review the diff in the user message and return ONLY JSON matching {issues,confidence,summary}. Write all natural-language text in ${language}. No prose.`,
    allowedTools: [] as ToolId[],
    allowedSkills: [] as SkillId[],
    outputSchema: {},
    memoryScope: 'review',
    priority: spec.priority,
    confidenceThreshold: 0.6,
    ...(spec.preferredTier ? { preferredTier: spec.preferredTier } : {}),
    temperature: 0,
  };
}

/**
 * Builds an executable handler for a specialist. The handler embeds the shared,
 * rendered context (the diff) once via `seedSlice` — it does not rebuild context
 * (ADR-0004) — asks the LLM, and maps the structured response into `Issue`s.
 */
export function makeSpecialistHandler(spec: SpecialistSpec, env?: Record<string, string>): AgentHandler {
  const agentId = spec.id as AgentId;
  const language = resolveCommentLanguage(env);
  return {
    run: async (ctx) => {
      const rendered = ctx.seedSlice?.rendered ?? '';
      const completion = await ctx.llm.complete({
        messages: [
          {
            role: 'system',
            content: `You are the ${spec.name}. FOCUS:${spec.focus}. Return ONLY JSON, no markdown fences, no prose, matching exactly: {"issues":[{"title":string,"description":string,"severity":"critical"|"high"|"medium"|"low"|"info","confidence":number (0..1, REQUIRED on every issue),"reason":string,"suggestion":string,"file":string,"line":number,"category":string}],"confidence":number,"summary":string}. Write the "title", "description", "reason", "suggestion", and "summary" text in ${language} — keep JSON keys, file paths, code identifiers, and severity/category values in English. Every issue MUST include a numeric "confidence" — omitting it causes the issue to be silently discarded.`,
            cacheable: true,
          },
          { role: 'user', content: rendered },
        ],
        temperature: 0,
        // Requesting a schema flips real providers into strict JSON mode
        // (ADR-0008). The mock ignores it; both return parseable JSON.
        jsonSchema: {
          type: 'object',
          properties: { issues: { type: 'array' }, confidence: { type: 'number' } },
          required: ['issues'],
        },
      });

      if (!completion.ok) return completion;

      // Strict-JSON mode isn't honored by every real provider/relay — some
      // still wrap the object in a markdown code fence despite the "no prose"
      // instruction. Strip it before parsing rather than failing the agent.
      const raw = completion.value.content.trim();
      const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw);
      const jsonText = fenced ? fenced[1]! : raw;

      let parsed: { issues?: RawFinding[]; confidence?: number; summary?: string };
      try {
        parsed = JSON.parse(jsonText) as typeof parsed;
      } catch {
        return {
          ok: false,
          error: {
            category: 'validation',
            code: 'agent.bad_json',
            message: `${spec.name} returned non-JSON content`,
          },
        };
      }

      const findings = parsed.issues ?? [];
      // Defensive mapping: real providers/relays don't always follow the
      // requested shape (e.g. omitting per-issue confidence entirely, which
      // would otherwise make `undefined >= threshold` silently reject every
      // real finding). Fall back to the agent's overall confidence, and to
      // sane defaults for anything else missing, rather than dropping issues.
      const overallConfidence = parsed.confidence;
      const issues: Issue[] = findings.map((f, idx) => ({
        id: `${spec.id}.${idx}` as IssueId,
        title: f.title ?? f.description?.slice(0, 80) ?? `${spec.name} finding`,
        description: f.description ?? '',
        severity: normalizeSeverity(f.severity),
        confidence: f.confidence ?? overallConfidence ?? 0.7,
        reason: f.reason ?? f.description ?? 'flagged by LLM review',
        suggestion: { description: f.suggestion ?? '' },
        location: { file: f.file ?? 'unknown', line: normalizeLine(f.line) },
        references: [],
        category: f.category ?? spec.focus,
        producedBy: agentId,
        fingerprint: fingerprint([f.file ?? '', String(f.line ?? ''), f.title ?? '', spec.focus]),
      }));

      const result: AgentResult = {
        agentId,
        issues,
        confidence: parsed.confidence ?? (issues.length === 0 ? 0.9 : 0.7),
        ...(parsed.summary ? { summary: parsed.summary } : {}),
        usage: completion.value.usage,
        model: completion.value.model,
      };
      return { ok: true, value: result };
    },
  };
}

export { fingerprint };
export type { RawFinding };
export type { ModelId };
