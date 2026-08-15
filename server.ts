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
      
      const { plan, SPECIALISTS } = await import('@ai-review/orchestrator');
      const reviewPlan = plan({
        diff: body.diff,
        specialists: SPECIALISTS,
        coveredCategories: [],
      });

      const selectedAgents = reviewPlan.selected.map((s: any) => s.name);
      const skippedAgents = reviewPlan.skipped.map((s: any) => s.spec.name);
      const agentCount = reviewPlan.selected.length;

      const inputTokensPerAgent = Math.ceil(body.diff.length / 4); 
      const totalInputTokens = inputTokensPerAgent * agentCount;
      
      let estimatedCostUsd = (totalInputTokens / 1000000) * 0.50; 
      
      const envOverrides = body.env ?? {};
      const provider = envOverrides.AI_REVIEW_LLM_PROVIDER ?? 'gemini';
      
      if (provider === 'mock' || provider === 'ollama') {
        estimatedCostUsd = 0;
      }

      res.status(200).json({
        agents: selectedAgents,
        skipped: skippedAgents,
        totalAgents: agentCount,
        estimatedTokens: totalInputTokens,
        estimatedCostUsd: Number(estimatedCostUsd.toFixed(5)),
      });
    } catch (err: any) {
      console.error("Estimate error:", err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
  });

  app.post("/api/review", async (req, res) => {
    try {
      const body = req.body;
      if (!body.diff || typeof body.diff !== 'string' || body.diff.trim().length === 0) {
        res.status(400).json({ error: 'field "diff" is required' });
        return;
      }
      
      const mergedEnv = { ...process.env, ...(body.env || {}) };

      const result = await runReview({
        diff: body.diff,
        ...(body.threshold !== undefined ? { confidenceThreshold: body.threshold } : {}),
        env: mergedEnv,
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
