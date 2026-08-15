import { useState } from 'react';
import { useAppConfig } from './Settings.js';

export function SettingsView() {
  const [config, setConfig] = useAppConfig();
  const [local, setLocal] = useState(config);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setConfig(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-view" style={{ maxWidth: '600px' }}>
      <header className="view-header" style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Configuration</h1>
        <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>
          Configure your LLM provider, API keys, and model parameters.
        </p>
      </header>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.25rem 0' }}>Test Mode (Mock Agent)</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
              Run the pipeline entirely offline using mock responses. No API keys required, zero cost.
            </p>
          </div>
          <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', flexShrink: 0 }}>
            <input 
              type="checkbox" 
              checked={local.AI_REVIEW_LLM_PROVIDER === 'mock'}
              onChange={(e) => {
                setLocal({
                  ...local,
                  AI_REVIEW_LLM_PROVIDER: e.target.checked ? 'mock' : 'gemini'
                });
              }}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{ 
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
              backgroundColor: local.AI_REVIEW_LLM_PROVIDER === 'mock' ? 'var(--accent)' : 'var(--border)', 
              transition: '.4s', borderRadius: '24px' 
            }}>
              <span style={{
                position: 'absolute', content: '""', height: '16px', width: '16px', left: '4px', bottom: '4px',
                backgroundColor: 'white', transition: '.4s', borderRadius: '50%',
                transform: local.AI_REVIEW_LLM_PROVIDER === 'mock' ? 'translateX(26px)' : 'none'
              }} />
            </span>
          </label>
        </div>
      </div>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', opacity: local.AI_REVIEW_LLM_PROVIDER === 'mock' ? 0.5 : 1, pointerEvents: local.AI_REVIEW_LLM_PROVIDER === 'mock' ? 'none' : 'auto', marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label>LLM Provider</label>
          <select
            value={local.AI_REVIEW_LLM_PROVIDER}
            onChange={(e) => setLocal({ ...local, AI_REVIEW_LLM_PROVIDER: e.target.value })}
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama (Local / Free)</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </div>
        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={local.AI_REVIEW_LLM_API_KEY}
            onChange={(e) => setLocal({ ...local, AI_REVIEW_LLM_API_KEY: e.target.value })}
            placeholder={local.AI_REVIEW_LLM_PROVIDER === 'ollama' ? "Not required for this provider" : "Defaults to server env if empty"}
            disabled={local.AI_REVIEW_LLM_PROVIDER === 'ollama'}
          />
        </div>
        <div className="form-group">
          <label>Model (Optional)</label>
          <input
            type="text"
            value={local.AI_REVIEW_LLM_MODEL}
            onChange={(e) => setLocal({ ...local, AI_REVIEW_LLM_MODEL: e.target.value })}
            placeholder="Leave empty for default"
          />
        </div>
        <div className="form-group">
          <label>Base URL (Optional)</label>
          <input
            type="text"
            value={local.AI_REVIEW_LLM_BASE_URL}
            onChange={(e) => setLocal({ ...local, AI_REVIEW_LLM_BASE_URL: e.target.value })}
            placeholder="Custom gateway URL"
          />
        </div>
      </div>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Git Provider Settings</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>Configure credentials for pulling Merge Requests and publishing review comments.</p>
        
        <div className="form-group">
          <label>Git Provider Base URL</label>
          <input
            type="url"
            value={local.GITLAB_BASE_URL}
            onChange={(e) => setLocal({ ...local, GITLAB_BASE_URL: e.target.value })}
            placeholder="e.g. https://gitlab.com (Usually auto-detected from MR URL)"
          />
        </div>

        <div className="form-group">
          <label>Personal Access Token</label>
          <input
            type="password"
            value={local.GITLAB_TOKEN}
            onChange={(e) => setLocal({ ...local, GITLAB_TOKEN: e.target.value })}
            placeholder="glpat-... (Defaults to server env if empty)"
          />
        </div>
      </div>

      <div className="form-actions" style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={handleSave}>Save Configuration</button>
        {saved && <span style={{ color: 'var(--low)', fontSize: '0.9rem' }}>✓ Saved successfully</span>}
      </div>
    </div>
  );
}
