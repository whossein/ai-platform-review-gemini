import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { runReview } from '@ai-review/orchestrator';
import { loadDotEnv } from '@ai-review/shared';
import * as http from 'node:http';

loadDotEnv();

// Map AI Studio's default Gemini API key to this project's expected variables
if (process.env.GEMINI_API_KEY) {
  if (!process.env.AI_REVIEW_LLM_API_KEY) {
    process.env.AI_REVIEW_LLM_API_KEY = process.env.GEMINI_API_KEY;
  }
  if (!process.env.AI_REVIEW_LLM_PROVIDER) {
    process.env.AI_REVIEW_LLM_PROVIDER = 'gemini';
  }
}

async function resolveDiffInput(input: string, env: Record<string, string | undefined>): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }

  const { parseChangeRequestUrl, GitLabProvider, FetchHttpClient, baseUrlFromChangeRequestUrl } = await import('@ai-review/git');
  const ref = parseChangeRequestUrl(trimmed);
  if (!ref) {
    throw new Error('Unsupported URL format. Please provide a valid GitLab Merge Request or GitHub Pull Request URL.');
  }

  if (ref.provider === 'gitlab') {
    const token = env.GITLAB_TOKEN || env.GIT_TOKEN || '';
    const baseUrl = env.GITLAB_BASE_URL || baseUrlFromChangeRequestUrl(trimmed) || 'https://gitlab.com';
    const provider = new GitLabProvider(new FetchHttpClient(), { baseUrl, token });
    const diffRes = await provider.getDiff(ref);
    if (!diffRes.ok) {
      throw new Error(`Failed to fetch GitLab MR diff: ${diffRes.error.message}${!token ? ' (A GITLAB_TOKEN may be required in Settings)' : ''}`);
    }
    let metadataHeader = '';
    try {
      const crRes = await provider.getChangeRequest(ref);
      if (crRes.ok) {
        metadataHeader = `# Merge Request Metadata:\n# Source Branch: ${crRes.value.sourceBranch}\n# Target Branch: ${crRes.value.targetBranch}\n# MR Title: ${crRes.value.title}\n\n`;
      }
    } catch {
      // ignore metadata error
    }
    return metadataHeader + diffRes.value;
  }

  if (ref.provider === 'github') {
    const token = env.GITHUB_TOKEN || env.GIT_TOKEN;
    const diffUrl = trimmed.endsWith('.diff') ? trimmed : `${trimmed.replace(/\/+$/, '')}.diff`;
    const headers: Record<string, string> = {
      'User-Agent': 'AI-Review-Platform',
      'Accept': 'text/plain, application/vnd.github.v3.diff',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    const response = await fetch(diffUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub PR diff (HTTP ${response.status})${!token ? ' - if private, please configure GITHUB_TOKEN in Settings' : ''}`);
    }
    const text = await response.text();
    if (!text || text.trim().length === 0) {
      throw new Error('The pull request diff is empty.');
    }

    let metadataHeader = '';
    try {
      const apiUrl = `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.id}`;
      const apiRes = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'AI-Review-Platform',
          'Accept': 'application/vnd.github.v3+json',
          ...(token ? { 'Authorization': `token ${token}` } : {}),
        },
      });
      if (apiRes.ok) {
        const prData = (await apiRes.json()) as any;
        metadataHeader = `# Pull Request Metadata:\n# Source Branch: ${prData.head?.ref || ''}\n# Target Branch: ${prData.base?.ref || ''}\n# PR Title: ${prData.title || ''}\n\n`;
      }
    } catch {
      // ignore metadata error
    }

    return metadataHeader + text;
  }

  throw new Error(`Provider ${ref.provider} is not supported for fetching diffs.`);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/estimate", async (req, res) => {
    try {
      const body = req.body;
      if (!body.diff || typeof body.diff !== 'string' || body.diff.trim().length === 0) {
        res.status(400).json({ error: 'field "diff" is required' });
        return;
      }

      const envOverrides = body.env ?? {};
      const mergedEnv = { ...process.env, ...envOverrides };
      const rawDiff = await resolveDiffInput(body.diff, mergedEnv);
      
      const { plan, SPECIALISTS, DefaultRuleEngine, MapRuleRegistry, DEFAULT_RULES, ruleFindingToIssue } = await import('@ai-review/orchestrator');
      
      const files = parseDiffToFiles(rawDiff);
      const deterministicIssues = [];
      
      if (files.length > 0) {
        const ruleRegistry = new MapRuleRegistry();
        for (const rule of DEFAULT_RULES) ruleRegistry.register(rule);
        const ruleEngine = new DefaultRuleEngine(ruleRegistry);
        const ruleRes = await ruleEngine.run({
          repositoryId: 'repo.local',
          files: files,
        });
        
        if (ruleRes.ok) {
          for (const finding of ruleRes.value.findings) {
            deterministicIssues.push(ruleFindingToIssue(finding));
          }
        }
      }

      const reviewPlan = plan({
        diff: rawDiff,
        specialists: SPECIALISTS,
        coveredCategories: [], // Static analysis doesn't replace the need for LLM reviewers
      });

      const selectedAgents = reviewPlan.selected.map((s: any) => s.name);
      const skippedAgents = reviewPlan.skipped.map((s: any) => s.spec.name);
      const agentCount = reviewPlan.selected.length;

      // Estimate input tokens (diff characters / 4 + system/agent prompt overhead)
      const inputTokensPerAgent = Math.ceil(rawDiff.length / 4) + 600; 
      const totalInputTokens = inputTokensPerAgent * agentCount;

      // Estimate output completion tokens per specialist agent (typically 800-1200 tokens for JSON issue reporting)
      const outputTokensPerAgent = 1000;
      const totalOutputTokens = outputTokensPerAgent * agentCount;

      // Resolve pricing based on active provider and custom input/output costs
      const { resolveProviderPreset } = await import('@ai-review/llm');
      const providerValue = envOverrides.AI_REVIEW_LLM_PROVIDER ?? 'gemini';
      
      let inputCostPer1M = 0.15;
      let outputCostPer1M = 0.60;

      // Check if custom pricing configured in AI_PROVIDERS_JSON
      if (envOverrides.AI_PROVIDERS_JSON) {
        try {
          const providersData = JSON.parse(envOverrides.AI_PROVIDERS_JSON);
          const active = providersData.find(
            (p: any) => p.id === providerValue || p.provider === providerValue
          ) || providersData[0];

          if (active) {
            const preset = resolveProviderPreset(active.provider);
            if (typeof active.inputCostPer1M === 'number') {
              inputCostPer1M = active.inputCostPer1M;
            } else if (preset?.defaultInputCostPer1M !== undefined) {
              inputCostPer1M = preset.defaultInputCostPer1M;
            }
            if (typeof active.outputCostPer1M === 'number') {
              outputCostPer1M = active.outputCostPer1M;
            } else if (preset?.defaultOutputCostPer1M !== undefined) {
              outputCostPer1M = preset.defaultOutputCostPer1M;
            }
          }
        } catch {
          // ignore json parse error
        }
      } else {
        const preset = resolveProviderPreset(providerValue);
        if (preset?.defaultInputCostPer1M !== undefined) inputCostPer1M = preset.defaultInputCostPer1M;
        if (preset?.defaultOutputCostPer1M !== undefined) outputCostPer1M = preset.defaultOutputCostPer1M;
      }

      if (envOverrides.AI_REVIEW_INPUT_COST_PER_1M) {
        const parsed = parseFloat(envOverrides.AI_REVIEW_INPUT_COST_PER_1M);
        if (!isNaN(parsed)) inputCostPer1M = parsed;
      }
      if (envOverrides.AI_REVIEW_OUTPUT_COST_PER_1M) {
        const parsed = parseFloat(envOverrides.AI_REVIEW_OUTPUT_COST_PER_1M);
        if (!isNaN(parsed)) outputCostPer1M = parsed;
      }

      let estimatedCostUsd = 0;
      if (providerValue !== 'mock' && providerValue !== 'ollama') {
        const inputCost = (totalInputTokens / 1000000) * inputCostPer1M;
        const outputCost = (totalOutputTokens / 1000000) * outputCostPer1M;
        estimatedCostUsd = inputCost + outputCost;
      }

      res.status(200).json({
        agents: selectedAgents,
        skipped: skippedAgents,
        totalAgents: agentCount,
        estimatedTokens: totalInputTokens + totalOutputTokens,
        estimatedInputTokens: totalInputTokens,
        estimatedOutputTokens: totalOutputTokens,
        inputCostPer1M,
        outputCostPer1M,
        estimatedCostUsd: Number(estimatedCostUsd.toFixed(5)),
        deterministicIssues: deterministicIssues
      });
    } catch (err: any) {
      console.error("Estimate error:", err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

function parseDiffToFiles(diffText: string): { path: string, text: string }[] {
  const files: { path: string, text: string }[] = [];
  const lines = diffText.split('\n');
  let currentFile = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      if (currentFile) {
        files.push({ path: currentFile, text: currentContent.join('\n') });
      }
      currentFile = line.substring(4).replace(/^b\//, '').trim();
      currentContent = [];
    } else if (line.startsWith('@@ ')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        const nextLine = parseInt(match[1], 10);
        while (currentContent.length + 1 < nextLine) {
          currentContent.push('');
        }
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      currentContent.push(line.substring(1));
    } else if (line.startsWith(' ')) {
      currentContent.push(line.substring(1));
    }
  }
  if (currentFile) {
    files.push({ path: currentFile, text: currentContent.join('\n') });
  }
  return files;
}

  app.post("/api/test-provider", async (req, res) => {
    try {
      const { provider, apiKey, model, baseUrl } = req.body || {};
      if (!provider) {
        res.status(400).json({ ok: false, error: 'Provider name is required' });
        return;
      }

      if (provider === 'mock') {
        res.status(200).json({
          ok: true,
          message: 'Mock Provider (Offline mode, zero cost). Ready to simulate code reviews.',
          latencyMs: 8,
          model: 'mock-deterministic',
        });
        return;
      }

      const { resolveProviderPreset, OpenAICompatibleProvider, resolveApiKey } = await import('@ai-review/llm');
      const preset = resolveProviderPreset(provider) ?? resolveProviderPreset('openai')!;
      
      const effectiveBaseUrl = baseUrl || preset.defaultBaseUrl;
      const effectiveModel = model || preset.defaultModel;
      const effectiveApiKey = resolveApiKey(provider, preset.envPrefix, apiKey, process.env);

      if (!effectiveBaseUrl) {
        res.status(400).json({
          ok: false,
          error: `Base URL is missing for provider "${provider}". Please configure an endpoint URL.`,
        });
        return;
      }

      if (preset.requiresApiKey && !effectiveApiKey && provider !== 'ollama') {
        res.status(400).json({
          ok: false,
          error: `API Key is required for provider "${provider}". Please enter a valid API key or configure it in server environment.`,
        });
        return;
      }

      const startTime = Date.now();
      const testClient = new OpenAICompatibleProvider({
        providerId: `test.${provider}`,
        baseUrl: effectiveBaseUrl,
        ...(effectiveApiKey ? { apiKey: effectiveApiKey } : {}),
        models: [{ id: effectiveModel, tier: preset.defaultTier }],
      });

      const response = await testClient.complete({
        model: effectiveModel as any,
        messages: [
          { role: 'user', content: 'Respond with the single word "OK".' },
        ],
        maxTokens: 10,
        temperature: 0,
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        res.status(400).json({
          ok: false,
          error: response.error.message || 'Provider request failed',
          latencyMs,
        });
        return;
      }

      const snippet = response.value.content.trim().slice(0, 80) || 'OK';
      res.status(200).json({
        ok: true,
        message: `Successfully connected! Response: "${snippet}"`,
        latencyMs,
        model: effectiveModel,
        usage: response.value.usage,
      });
    } catch (err: any) {
      console.error("Test provider error:", err);
      res.status(500).json({
        ok: false,
        error: err.message || 'Internal server error while testing provider',
      });
    }
  });

  app.post("/api/review", async (req, res) => {
    // Prevent request timeout on long-running multi-agent reviews
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    res.setHeader('Connection', 'keep-alive');

    try {
      const body = req.body;
      if (!body.diff || typeof body.diff !== 'string' || body.diff.trim().length === 0) {
        res.status(400).json({ error: 'field "diff" is required' });
        return;
      }
      
      const mergedEnv = { ...process.env, ...(body.env || {}) };
      const rawDiff = await resolveDiffInput(body.diff, mergedEnv);
      
      const parsedFiles = parseDiffToFiles(rawDiff);

      const result = await runReview({
        diff: rawDiff,
        files: parsedFiles,
        ...(body.threshold !== undefined ? { confidenceThreshold: body.threshold } : {}),
        env: mergedEnv,
        ...(Array.isArray(body.selectedSpecialists) ? { selectedSpecialists: body.selectedSpecialists } : {}),
      });
      
      res.status(200).json({
        markdown: result.markdown,
        json: JSON.parse(result.json),
        accepted: result.accepted,
        total: result.total,
        issues: result.issues,
        metrics: result.metrics,
      });
    } catch (err: any) {
      console.error("Review error:", err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

  app.post("/api/publish", async (req, res) => {
    try {
      const body = req.body;
      const { diff, issues, env } = body;
      
      if (!diff || typeof diff !== 'string') {
        res.status(400).json({ error: 'field "diff" (Merge Request URL) is required' });
        return;
      }
      if (!issues || !Array.isArray(issues)) {
        res.status(400).json({ error: 'field "issues" is required' });
        return;
      }
      
      const mergedEnv = { ...process.env, ...(env || {}) };
      const token = mergedEnv.GITLAB_TOKEN || mergedEnv.GIT_TOKEN;
      if (!token) {
        res.status(400).json({ error: 'GITLAB_TOKEN is not configured in settings or environment' });
        return;
      }

      const { parseChangeRequestUrl, MapGitProviderRegistry, GitLabProvider, ReviewPublisher, FetchHttpClient, baseUrlFromChangeRequestUrl } = await import('@ai-review/git');
      
      const ref = parseChangeRequestUrl(diff);
      if (!ref) {
        res.status(400).json({ error: 'The provided input is not a recognized Merge Request URL. You can only publish if you started the review from an MR URL.' });
        return;
      }

      const registry = new MapGitProviderRegistry();
      const http = new FetchHttpClient();
      
      if (ref.provider === 'gitlab') {
        const baseUrl = mergedEnv.GITLAB_BASE_URL || baseUrlFromChangeRequestUrl(diff) || 'https://gitlab.com';
        registry.register(new GitLabProvider({ baseUrl, token }, http));
      } else {
        res.status(400).json({ error: `Provider ${ref.provider} is not currently supported for publishing` });
        return;
      }

      const publisher = new ReviewPublisher(registry);
      const result = await publisher.publish(ref, issues, { 
        dryRun: false,
        approveIfClean: true
      });

      if (result.ok) {
        res.status(200).json({ success: true, result: result.value });
      } else {
        res.status(500).json({ error: result.error.message || 'Failed to publish' });
      }
    } catch (err: any) {
      console.error("Publish error:", err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

  app.post("/api/apply-local", async (req, res) => {
    try {
      const body = req.body;
      const { localPath, issues } = body;

      if (!localPath || typeof localPath !== 'string') {
        res.status(400).json({ error: 'field "localPath" is required' });
        return;
      }
      if (!issues || !Array.isArray(issues)) {
        res.status(400).json({ error: 'field "issues" is required' });
        return;
      }

      const fs = await import('fs/promises');
      const path = await import('path');

      const byFile = issues.reduce((acc: any, issue: any) => {
        if (!issue.accepted) return acc;
        if (!acc[issue.location.file]) acc[issue.location.file] = [];
        acc[issue.location.file].push(issue);
        return acc;
      }, {});

      for (const [file, fileIssues] of Object.entries(byFile)) {
        const fullPath = path.resolve(localPath, file);
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isFile()) continue;

          const content = await fs.readFile(fullPath, 'utf8');
          const lines = content.split('\n');

          // Sort issues descending by line number so inserting doesn't mess up subsequent line numbers
          const sortedIssues = (fileIssues as any[]).sort((a, b) => (b.location.line || 0) - (a.location.line || 0));

          for (const issue of sortedIssues) {
            const lineNum = issue.location.line ? Math.max(1, issue.location.line) - 1 : 0;
            const prefix = issue.severity === 'critical' || issue.severity === 'high' ? 'FIXME' : 'TODO';
            
            const commentLines = [
              `// ${prefix} [${issue.severity.toUpperCase()}]: ${issue.title} - ${issue.reason}`
            ];
            if (issue.suggestion && issue.suggestion.description) {
              commentLines.push(`// Suggestion: ${issue.suggestion.description}`);
            }

            // Figure out indentation of the target line
            const targetLine = lines[lineNum] || '';
            const match = targetLine.match(/^(\s*)/);
            const indent = match ? match[1] : '';

            const indentedComments = commentLines.map(c => indent + c);

            lines.splice(lineNum, 0, ...indentedComments);
          }

          await fs.writeFile(fullPath, lines.join('\n'), 'utf8');
        } catch (e) {
          console.warn(`Could not apply to file ${fullPath}:`, e);
          // skip missing files
        }
      }

      res.status(200).json({ success: true });
    } catch (err: any) {
      console.error("Apply local error:", err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    // We must point vite to the apps/web directory
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: path.resolve(process.cwd(), "apps/web"),
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'apps/web/dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Keep connections alive during deep AI multi-agent reviews (10 mins)
  server.timeout = 600_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 610_000;
}

startServer().catch(console.error);
