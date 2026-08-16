import { useEffect, useState } from 'react';
import { requestReview, requestEstimate, checkHealth, type ReviewIssue, type ReviewResponse, type EstimateResponse } from './api.js';
import { useAppConfig } from './Settings.js';

const SAMPLE_DIFF = `diff --git a/src/UserList.tsx b/src/UserList.tsx
--- a/src/UserList.tsx
+++ b/src/UserList.tsx
@@ -1,3 +1,12 @@
+const API_KEY = "sk-live-abcdef123456";
+export function UserList({ users }: { users: any }) {
+  console.log("rendering", users);
+  return (
+    <ul>
+      {users.map((u) => <li>{u.name}</li>)}
+    </ul>
+  );
+}
+`;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function IssueCard({ issue }: { issue: ReviewIssue }): JSX.Element {
  return (
    <li className={`issue sev-${issue.severity}`} data-accepted={issue.accepted}>
      <div className="issue-head">
        <span className={`badge sev-${issue.severity}`}>{issue.severity}</span>
        <span className="issue-title">{issue.title}</span>
        <span className="issue-confidence">{Math.round(issue.confidence * 100)}%</span>
      </div>
      <div className="issue-loc">
        {issue.location.file}
        {issue.location.line ? `:${issue.location.line}` : ''} · {issue.category}
      </div>
      <p className="issue-why">{issue.reason}</p>
      {issue.suggestion ? (
        <p className="issue-fix">
          <strong>Suggestion:</strong> {issue.suggestion.description}
        </p>
      ) : null}
    </li>
  );
}

function buildEnvOverrides(config: any, language: string) {
  const envOverrides: Record<string, string> = {
    AI_REVIEW_LLM_PROVIDER: config.AI_REVIEW_LLM_PROVIDER || 'openai',
    AI_REVIEW_COMMENT_LANGUAGE: language
  };
  if (config.AI_REVIEW_LLM_API_KEY) envOverrides.AI_REVIEW_LLM_API_KEY = config.AI_REVIEW_LLM_API_KEY;
  if (config.AI_REVIEW_LLM_MODEL) envOverrides.AI_REVIEW_LLM_MODEL = config.AI_REVIEW_LLM_MODEL;
  if (config.AI_REVIEW_LLM_BASE_URL) envOverrides.AI_REVIEW_LLM_BASE_URL = config.AI_REVIEW_LLM_BASE_URL;

  if (config.AI_PROVIDERS && config.AI_PROVIDERS.length > 0) {
    envOverrides.AI_PROVIDERS_JSON = JSON.stringify(config.AI_PROVIDERS);
    for (const p of config.AI_PROVIDERS) {
      const prefix = p.provider.toUpperCase();
      if (p.apiKey) envOverrides[`AI_REVIEW_${prefix}_API_KEY`] = p.apiKey;
      if (p.model) envOverrides[`AI_REVIEW_${prefix}_MODEL`] = p.model;
      if (p.baseUrl) envOverrides[`AI_REVIEW_${prefix}_BASE_URL`] = p.baseUrl;
    }
  }

  if (config.GITLAB_TOKEN) envOverrides.GITLAB_TOKEN = config.GITLAB_TOKEN;
  if (config.GITLAB_BASE_URL) envOverrides.GITLAB_BASE_URL = config.GITLAB_BASE_URL;

  return envOverrides;
}

type InputMode = 'diff' | 'pr' | 'zip' | 'path' | 'repo';

export function ReviewView(): JSX.Element {
  const [inputMode, setInputMode] = useState<InputMode>('diff');
  const [diff, setDiff] = useState<string>(SAMPLE_DIFF);
  const [prUrl, setPrUrl] = useState<string>('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [localPath, setLocalPath] = useState<string>('');
  const [repoUrl, setRepoUrl] = useState<string>('');
  
  const [threshold, setThreshold] = useState<number>(0.6);
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [estimating, setEstimating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [config] = useAppConfig();
  const [reportMode, setReportMode] = useState<'visual' | 'markdown' | 'inline' | 'json'>('visual');
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishSuccess, setPublishSuccess] = useState<boolean>(false);
  const [language, setLanguage] = useState<'en' | 'fa'>('en');
  const [applying, setApplying] = useState<boolean>(false);
  const [applySuccess, setApplySuccess] = useState<boolean>(false);

  // Budget calculations
  const budgetLimit = config.BUDGET_LIMIT ? parseFloat(config.BUDGET_LIMIT) : null;
  const currentTotalAgents = selectedAgents.size;
  const currentEstimatedCost = estimate && estimate.totalAgents > 0 
    ? (estimate.estimatedCostUsd / estimate.totalAgents) * currentTotalAgents 
    : 0;
  const isOverBudget = budgetLimit !== null && currentEstimatedCost > budgetLimit;

  useEffect(() => {
    void checkHealth().then(setApiUp);
  }, []);

  async function onApplyLocal(): Promise<void> {
    if (!result || !result.issues || !localPath) return;
    setApplying(true);
    setError(null);
    setApplySuccess(false);

    try {
      const { requestApplyLocal } = await import('./api.js');
      await requestApplyLocal(localPath, result.issues);
      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 5000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  async function onPublish(): Promise<void> {
    if (!result || !result.issues) return;
    setPublishing(true);
    setError(null);
    setPublishSuccess(false);

    let diffToPublish = diff;
    if (inputMode === 'pr' && prUrl) diffToPublish = prUrl;

    try {
      const { requestPublish } = await import('./api.js');
      await requestPublish(diffToPublish, result.issues, config as any);
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 5000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function onEstimate(): Promise<void> {
    setEstimating(true);
    setError(null);
    setEstimate(null);
    setResult(null);

    let diffToEstimate = diff;

    if (inputMode !== 'diff') {
      setError('Estimation is currently only supported for Raw Diff inputs.');
      setEstimating(false);
      return;
    }

    try {
      const envOverrides = buildEnvOverrides(config, language);

      const res = await requestEstimate(diffToEstimate, envOverrides);
      setEstimate(res);
      setSelectedAgents(new Set(res.agents));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'estimation failed');
    } finally {
      setEstimating(false);
    }
  }

  async function onReview(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);

    let diffToReview = diff;

    if (inputMode === 'pr') {
      if (!prUrl.trim()) {
        setError('Please enter a valid Merge Request or Pull Request URL.');
        setLoading(false);
        return;
      }
      setError('Pull Request / Merge Request URL integration is not yet implemented in the backend. Please wait for further instructions.');
      setLoading(false);
      return;
    }
    
    if (inputMode === 'zip') {
      if (!zipFile) {
        setError('Please select a ZIP file to upload.');
        setLoading(false);
        return;
      }
      setError('ZIP file upload is not yet implemented in the backend. Please wait for further instructions.');
      setLoading(false);
      return;
    }
    
    if (inputMode === 'path') {
      if (!localPath) {
        setError('Please select a local directory.');
        setLoading(false);
        return;
      }
      setError('Local directory processing is not yet implemented in the backend. Please wait for further instructions.');
      setLoading(false);
      return;
    }
    
    if (inputMode === 'repo') {
      if (!repoUrl.trim()) {
        setError('Please enter a valid Git Repository URL.');
        setLoading(false);
        return;
      }
      setError('Git repository cloning is not yet implemented in the backend. Please wait for further instructions.');
      setLoading(false);
      return;
    }

    try {
      const envOverrides = buildEnvOverrides(config, language);

      const res = await requestReview(diffToReview, threshold, envOverrides, Array.from(selectedAgents));
      setResult(res);
      
      try {
        const { saveReviewToHistory } = await import('./history.js');
        let target = 'Custom diff snippet';
        // Cast inputMode to any to bypass TS narrowing from earlier early-returns
        const mode = inputMode as any;
        if (mode === 'pr') target = prUrl;
        else if (mode === 'path') target = localPath;
        else if (mode === 'repo') target = repoUrl;
        else if (mode === 'zip') target = zipFile?.name || 'ZIP File';
        
        const usedModel = config.AI_REVIEW_LLM_MODEL || config.AI_REVIEW_LLM_PROVIDER || 'Unknown Model';
        saveReviewToHistory(mode, target, usedModel, res);
      } catch (e) {
        console.warn('Failed to save to history', e);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'review failed');
    } finally {
      setLoading(false);
    }
  }

  const issues = result
    ? [...result.issues].sort(
        (a, b) =>
          (a.accepted === b.accepted ? 0 : a.accepted ? -1 : 1) ||
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          b.rankScore - a.rankScore,
      )
    : [];

  function generateInlineComments(iss: ReviewIssue[]): string {
    if (iss.length === 0) return 'No issues found to comment on.';
    let output = '';
    const byFile = iss.reduce((acc, issue) => {
      if (!acc[issue.location.file]) acc[issue.location.file] = [];
      acc[issue.location.file].push(issue);
      return acc;
    }, {} as Record<string, ReviewIssue[]>);
    
    for (const [file, fileIssues] of Object.entries(byFile)) {
      output += `// ==================================================================\n`;
      output += `// File: ${file}\n`;
      output += `// ==================================================================\n\n`;
      for (const issue of fileIssues) {
        const lineStr = issue.location.line ? `Line ${issue.location.line}` : 'Global Context';
        const prefix = issue.severity === 'critical' || issue.severity === 'high' ? 'FIXME' : 'TODO';
        output += `// ${prefix} [${issue.severity.toUpperCase()}] at ${lineStr}:\n`;
        output += `// ${issue.title} - ${issue.reason}\n`;
        if (issue.suggestion) {
          output += `// Suggestion: ${issue.suggestion.description}\n`;
        }
        output += `\n`;
      }
    }
    return output;
  }

  return (
    <div className="review-view" style={{ maxWidth: '900px' }}>
      <header className="view-header" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Code Review</h1>
          <span className={`api-status ${apiUp ? 'up' : 'down'}`}>
            {apiUp == null ? 'checking API…' : apiUp ? 'API online' : 'API offline'}
          </span>
          {config.AI_REVIEW_LLM_PROVIDER === 'mock' && (
            <span style={{ background: 'var(--accent)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
              TEST MODE (MOCK)
            </span>
          )}
        </div>
        <p className="tagline" style={{ marginTop: '0.5rem' }}>
          Start a review by providing a diff or a Merge Request URL.
        </p>
      </header>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: inputMode === 'diff' ? 'var(--accent)' : 'var(--muted)', fontWeight: inputMode === 'diff' ? 600 : 400 }}>
            <input type="radio" name="inputMode" value="diff" checked={inputMode === 'diff'} onChange={() => setInputMode('diff')} style={{ accentColor: 'var(--accent)' }} />
            Raw Diff
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: inputMode === 'pr' ? 'var(--accent)' : 'var(--muted)', fontWeight: inputMode === 'pr' ? 600 : 400 }}>
            <input type="radio" name="inputMode" value="pr" checked={inputMode === 'pr'} onChange={() => setInputMode('pr')} style={{ accentColor: 'var(--accent)' }} />
            Merge Request URL
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: inputMode === 'zip' ? 'var(--accent)' : 'var(--muted)', fontWeight: inputMode === 'zip' ? 600 : 400 }}>
            <input type="radio" name="inputMode" value="zip" checked={inputMode === 'zip'} onChange={() => setInputMode('zip')} style={{ accentColor: 'var(--accent)' }} />
            ZIP File
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: inputMode === 'path' ? 'var(--accent)' : 'var(--muted)', fontWeight: inputMode === 'path' ? 600 : 400 }}>
            <input type="radio" name="inputMode" value="path" checked={inputMode === 'path'} onChange={() => setInputMode('path')} style={{ accentColor: 'var(--accent)' }} />
            Local Path
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: inputMode === 'repo' ? 'var(--accent)' : 'var(--muted)', fontWeight: inputMode === 'repo' ? 600 : 400 }}>
            <input type="radio" name="inputMode" value="repo" checked={inputMode === 'repo'} onChange={() => setInputMode('repo')} style={{ accentColor: 'var(--accent)' }} />
            Git Repository
          </label>
        </div>

        {inputMode === 'diff' && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Unified Diff Content</label>
            <textarea
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              spellCheck={false}
              rows={12}
              placeholder="Paste a unified diff here…"
              style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>
        )}
        
        {inputMode === 'pr' && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Merge Request / Pull Request URL</label>
            <input 
              type="url"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="https://github.com/org/repo/pull/123 or GitLab MR url"
              style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem' }}
            />
          </div>
        )}

        {inputMode === 'zip' && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Source Code Archive (.zip)</label>
            <input 
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] || null)}
              style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px dashed var(--border)', borderRadius: '6px', padding: '2rem 1rem', textAlign: 'center', cursor: 'pointer' }}
            />
            {zipFile && <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--low)' }}>Selected: {zipFile.name}</p>}
          </div>
        )}

        {inputMode === 'path' && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Select Local Directory</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input 
                type="file"
                // @ts-ignore - webkitdirectory is non-standard but widely supported
                webkitdirectory=""
                directory=""
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setLocalPath(`Selected ${e.target.files.length} files from directory`);
                  } else {
                    setLocalPath('');
                  }
                }}
                style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px dashed var(--border)', borderRadius: '6px', padding: '2rem 1rem', textAlign: 'center', cursor: 'pointer' }}
              />
              {localPath && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--low)' }}>{localPath}</p>}
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
              Note: The browser will ask for permission to read the directory.
            </p>
          </div>
        )}

        {inputMode === 'repo' && (
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Git Repository URL</label>
            <input 
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
              style={{ width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem' }}
            />
          </div>
        )}

        <div className="controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
          <div className="form-group" style={{ flex: 1, maxWidth: '200px', margin: 0 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>Confidence Threshold</span>
              <strong>{threshold.toFixed(2)}</strong>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          <div className="form-group" style={{ flex: 1, maxWidth: '200px', margin: 0 }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Comment Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'fa')}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            >
              <option value="en">English (Default)</option>
              <option value="fa">Persian (فارسی)</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {!estimate && !result && (
              <button 
                onClick={() => void onEstimate()} 
                disabled={
                  estimating || loading || 
                  (inputMode === 'diff' && diff.trim().length === 0) || 
                  inputMode !== 'diff'
                }
                className="secondary-button"
                style={{ minWidth: '150px', background: 'var(--accent)', color: 'white', border: 'none' }}
              >
                {estimating ? 'Analyzing...' : 'Run Pre-Review & Estimate'}
              </button>
            )}

            {estimate && !result && (
              <button 
                onClick={() => void onEstimate()} 
                disabled={estimating || loading}
                className="secondary-button"
                style={{ minWidth: '130px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                {estimating ? 'Recalculating…' : 'Re-Estimate'}
              </button>
            )}
            
            {(estimate || result) && (
              <button 
                onClick={() => void onReview()} 
                disabled={
                  loading || 
                  isOverBudget ||
                  (inputMode === 'diff' && diff.trim().length === 0) || 
                  (inputMode === 'pr' && prUrl.trim().length === 0) ||
                  (inputMode === 'zip' && !zipFile) ||
                  (inputMode === 'path' && localPath.trim().length === 0) ||
                  (inputMode === 'repo' && repoUrl.trim().length === 0)
                }
                style={{ minWidth: '150px', opacity: isOverBudget ? 0.5 : 1, cursor: isOverBudget ? 'not-allowed' : undefined }}
                title={isOverBudget ? "Estimated cost exceeds your budget limit" : undefined}
              >
                {loading ? 'Reviewing…' : 'Start AI Code Review'}
              </button>
            )}
          </div>
        </div>
      </div>

      {estimate && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
          {estimate.deterministicIssues && estimate.deterministicIssues.length > 0 && (
            <div style={{ background: 'rgba(255, 171, 0, 0.05)', border: '1px solid rgba(255, 171, 0, 0.3)', padding: '1.25rem', borderRadius: '12px' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#eab308' }}>
                Pre-Review Findings (Static Analysis)
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text)', marginBottom: '1rem' }}>These issues were found instantly without using AI tokens.</p>
              <ul className="issue-list" style={{ marginTop: 0 }}>
                {estimate.deterministicIssues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </ul>
            </div>
          )}

          <div style={{ background: 'rgba(47, 129, 247, 0.05)', border: '1px solid rgba(47, 129, 247, 0.2)', padding: '1.25rem', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text)' }}>
              AI Review Estimation
            </h3>
            {(() => {
              const tokensPerAgent = estimate.totalAgents > 0 ? estimate.estimatedTokens / estimate.totalAgents : 0;
              const currentEstimatedTokens = tokensPerAgent * currentTotalAgents;
              const allAgents = Array.from(new Set([...estimate.agents, ...estimate.skipped])).sort();

              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Agents Active</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text)' }}>{currentTotalAgents}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Est. Input Tokens</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text)' }}>{Math.round(currentEstimatedTokens).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Est. Cost (USD)</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: isOverBudget ? '#f87171' : 'var(--low)' }}>
                        ~${currentEstimatedCost.toFixed(4)}
                        {isOverBudget && <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: '#f87171', fontWeight: 'normal' }}>(Exceeds limit of ${budgetLimit?.toFixed(2)})</span>}
                      </div>
                    </div>
                    {budgetLimit !== null && (
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Max Budget</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text)' }}>${budgetLimit.toFixed(2)}</div>
                      </div>
                    )}
                  </div>
                  
                  <div style={{ fontSize: '0.85rem', marginTop: '1rem' }}>
                    <div style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontWeight: 600 }}>Select Specialists for Review:</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                      {allAgents.map((a) => (
                        <label key={a} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: selectedAgents.has(a) ? 'var(--text)' : 'var(--muted)' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedAgents.has(a)} 
                            onChange={() => {
                              setSelectedAgents(prev => {
                                const next = new Set(prev);
                                if (next.has(a)) next.delete(a);
                                else next.add(a);
                                return next;
                              });
                            }}
                          />
                          {a}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {error ? <div className="error" style={{ marginBottom: '1.5rem' }}>⚠ {error}</div> : null}

      {result ? (
        <section className="results" dir={language === 'fa' ? 'rtl' : 'ltr'} style={{ textAlign: language === 'fa' ? 'right' : 'left' }}>
          <div className="summary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem', flexDirection: language === 'fa' ? 'row-reverse' : 'row' }}>
            <div dir="ltr">
              <strong>{result.accepted}</strong> accepted / {result.total} total findings
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--panel)', padding: '0.25rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <button onClick={() => setReportMode('visual')} style={{ background: reportMode === 'visual' ? 'var(--accent)' : 'transparent', color: reportMode === 'visual' ? 'white' : 'var(--text)', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: reportMode === 'visual' ? 600 : 400 }}>Snippet Report</button>
              <button onClick={() => setReportMode('markdown')} style={{ background: reportMode === 'markdown' ? 'var(--accent)' : 'transparent', color: reportMode === 'markdown' ? 'white' : 'var(--text)', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: reportMode === 'markdown' ? 600 : 400 }}>PR Comment (MD)</button>
              <button onClick={() => setReportMode('inline')} style={{ background: reportMode === 'inline' ? 'var(--accent)' : 'transparent', color: reportMode === 'inline' ? 'white' : 'var(--text)', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: reportMode === 'inline' ? 600 : 400 }}>Inline Comments</button>
              <button onClick={() => setReportMode('json')} style={{ background: reportMode === 'json' ? 'var(--accent)' : 'transparent', color: reportMode === 'json' ? 'white' : 'var(--text)', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: reportMode === 'json' ? 600 : 400 }}>JSON (CI/CD)</button>
            </div>
          </div>

          {reportMode === 'visual' && (
            issues.length === 0 ? (
              <p className="empty">No findings.</p>
            ) : (
              <ul className="issues">
                {issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </ul>
            )
          )}

          {reportMode === 'markdown' && (
            <div>
              <div style={{ background: 'var(--panel)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem' }}>
                <pre style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                  {result.markdown}
                </pre>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  onClick={onPublish} 
                  disabled={publishing || inputMode !== 'pr'}
                  style={{ 
                    padding: '0.75rem 1.5rem', 
                    background: inputMode !== 'pr' ? 'var(--border)' : 'var(--accent)', 
                    color: inputMode !== 'pr' ? 'var(--muted)' : 'white', 
                    border: 'none', 
                    borderRadius: '8px', 
                    fontWeight: 600, 
                    cursor: inputMode !== 'pr' ? 'not-allowed' : 'pointer'
                  }}
                >
                  {publishing ? 'Publishing...' : 'Publish to Merge Request'}
                </button>
                {inputMode !== 'pr' && <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>You must use a Merge Request URL to publish directly.</span>}
                {publishSuccess && <span style={{ fontSize: '0.85rem', color: 'var(--low)', fontWeight: 600 }}>✓ Published Successfully!</span>}
              </div>
            </div>
          )}

          {reportMode === 'inline' && (
            <div>
              <div style={{ background: 'var(--panel)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto', marginBottom: '1rem' }}>
                <p style={{ marginTop: 0, marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Pseudo-code snippet representation of findings with inline comments. You can copy these to fix your code.</p>
                <pre style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'var(--accent)' }}>
                  {generateInlineComments(issues.filter(i => i.accepted))}
                </pre>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={onPublish} 
                  disabled={publishing || inputMode !== 'pr'}
                  style={{ 
                    padding: '0.75rem 1.5rem', 
                    background: inputMode !== 'pr' ? 'var(--border)' : 'var(--accent)', 
                    color: inputMode !== 'pr' ? 'var(--muted)' : 'white', 
                    border: 'none', 
                    borderRadius: '8px', 
                    fontWeight: 600, 
                    cursor: inputMode !== 'pr' ? 'not-allowed' : 'pointer'
                  }}
                >
                  {publishing ? 'Publishing...' : 'Publish to Merge Request'}
                </button>
                <button 
                  onClick={onApplyLocal} 
                  disabled={applying || inputMode !== 'path'}
                  style={{ 
                    padding: '0.75rem 1.5rem', 
                    background: inputMode !== 'path' ? 'var(--border)' : 'var(--low)', 
                    color: inputMode !== 'path' ? 'var(--muted)' : 'white', 
                    border: 'none', 
                    borderRadius: '8px', 
                    fontWeight: 600, 
                    cursor: inputMode !== 'path' ? 'not-allowed' : 'pointer'
                  }}
                >
                  {applying ? 'Applying...' : 'Apply to Local Files'}
                </button>
                {inputMode !== 'pr' && inputMode !== 'path' && <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Requires MR URL or Local Path input mode.</span>}
                {publishSuccess && <span style={{ fontSize: '0.85rem', color: 'var(--low)', fontWeight: 600 }}>✓ Published Successfully!</span>}
                {applySuccess && <span style={{ fontSize: '0.85rem', color: 'var(--low)', fontWeight: 600 }}>✓ Applied to Local Files!</span>}
              </div>
            </div>
          )}

          {reportMode === 'json' && (
            <div style={{ background: 'var(--panel)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto' }}>
              <pre style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                {JSON.stringify(result.json, null, 2)}
              </pre>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
