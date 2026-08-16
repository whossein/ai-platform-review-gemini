import { useState } from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { useAppConfig } from './Settings.js';
import type { AIProviderConfig } from './Settings.js';

export function SettingsView() {
  const [config, setConfig] = useAppConfig();
  const [local, setLocal] = useState(config);
  const [saved, setSaved] = useState(false);
  
  const [newProvider, setNewProvider] = useState<AIProviderConfig>({
    id: '',
    provider: 'openai',
    apiKey: '',
    model: '',
    baseUrl: '',
    tier: 'mid',
  });

  const handleSave = () => {
    setConfig(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddProvider = () => {
    const id = Date.now().toString();
    const p = { ...newProvider, id };
    const providers = local.AI_PROVIDERS ? [...local.AI_PROVIDERS] : [];
    
    // Auto-set as default if it's the first one
    if (providers.length === 0 || !local.AI_REVIEW_LLM_PROVIDER || local.AI_REVIEW_LLM_PROVIDER === 'mock') {
      setLocal({
        ...local,
        AI_PROVIDERS: [...providers, p],
        AI_REVIEW_LLM_PROVIDER: p.id,
      });
    } else {
      setLocal({
        ...local,
        AI_PROVIDERS: [...providers, p],
      });
    }
    
    setNewProvider({ id: '', provider: 'openai', apiKey: '', model: '', baseUrl: '', tier: 'mid' });
  };

  const handleDeleteProvider = (id: string) => {
    const providers = (local.AI_PROVIDERS || []).filter(p => p.id !== id);
    setLocal({
      ...local,
      AI_PROVIDERS: providers,
    });
  };

  const handleSetDefaultProvider = (providerId: string) => {
    setLocal({ ...local, AI_REVIEW_LLM_PROVIDER: providerId });
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
                  AI_REVIEW_LLM_PROVIDER: e.target.checked ? 'mock' : (local.AI_PROVIDERS?.[0]?.provider || 'gemini')
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
        <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>AI Providers</h2>
        
        {/* New Provider Form */}
        <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 1rem 0' }}>Add New Provider</h3>
          <div className="form-group">
            <label>Provider</label>
            <select
              value={newProvider.provider}
              onChange={(e) => setNewProvider({ ...newProvider, provider: e.target.value })}
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
              value={newProvider.apiKey}
              onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
              placeholder={newProvider.provider === 'ollama' ? "Not required for this provider" : "API Key (Defaults to env if empty)"}
              disabled={newProvider.provider === 'ollama'}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Model (Optional)</label>
              <input
                type="text"
                value={newProvider.model}
                onChange={(e) => setNewProvider({ ...newProvider, model: e.target.value })}
                placeholder="Leave empty for default"
              />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Tier / Cost (Optional)</label>
              <select
                value={newProvider.tier || 'mid'}
                onChange={(e) => setNewProvider({ ...newProvider, tier: e.target.value })}
              >
                <option value="cheap">Cheap (Low Cost)</option>
                <option value="mid">Medium (Balanced)</option>
                <option value="premium">Expensive / Premium (High Quality)</option>
                <option value="local">Local (Free / Offline)</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
            <label>Base URL (Optional)</label>
            <input
              type="text"
              value={newProvider.baseUrl}
              onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
              placeholder="Custom gateway URL"
            />
          </div>
          <button 
            onClick={handleAddProvider} 
            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            <Plus size={16} /> Add Provider
          </button>
        </div>

        {/* List of saved providers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(local.AI_PROVIDERS || []).map((p) => {
            const isDefault = local.AI_REVIEW_LLM_PROVIDER === p.id;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', border: isDefault ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: '8px', background: 'var(--panel)' }}>
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ textTransform: 'capitalize' }}>{p.provider}</span>
                    {p.tier && (
                      <span style={{ fontSize: '0.7rem', background: 'var(--border)', color: 'var(--text)', padding: '0.1rem 0.4rem', borderRadius: '4px', textTransform: 'capitalize' }}>
                        Tier: {p.tier}
                      </span>
                    )}
                    {isDefault && <span style={{ fontSize: '0.7rem', background: 'var(--accent)', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Active</span>}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {p.model && <span>Model: {p.model} &bull; </span>}
                    {p.apiKey ? 'Key configured' : 'Using default/env key'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {!isDefault && (
                    <button 
                      onClick={() => handleSetDefaultProvider(p.id)}
                      title="Set as active provider"
                      style={{ padding: '0.4rem', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                    >
                      <Star size={18} />
                    </button>
                  )}
                  <button 
                    onClick={() => handleDeleteProvider(p.id)}
                    style={{ padding: '0.4rem', background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
          {(!local.AI_PROVIDERS || local.AI_PROVIDERS.length === 0) && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
              No AI providers configured. Add one above.
            </div>
          )}
        </div>
      </div>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Git Provider Settings</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>Configure credentials for pulling Pull/Merge Requests and publishing review comments.</p>
        
        <div className="form-group">
          <label>GitLab Base URL</label>
          <input
            type="url"
            value={local.GITLAB_BASE_URL}
            onChange={(e) => setLocal({ ...local, GITLAB_BASE_URL: e.target.value })}
            placeholder="e.g. https://gitlab.com (Usually auto-detected from MR URL)"
          />
        </div>
        <div className="form-group">
          <label>GitLab Personal Access Token</label>
          <input
            type="password"
            value={local.GITLAB_TOKEN}
            onChange={(e) => setLocal({ ...local, GITLAB_TOKEN: e.target.value })}
            placeholder="glpat-... (Defaults to server env if empty)"
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>GitHub Personal Access Token (for private repos)</label>
          <input
            type="password"
            value={local.GITHUB_TOKEN || ''}
            onChange={(e) => setLocal({ ...local, GITHUB_TOKEN: e.target.value })}
            placeholder="ghp_... (Optional for public repositories)"
          />
        </div>
      </div>

      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Budget & Limits</h2>
        <div className="form-group">
          <label>Max Budget per Request (USD)</label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={local.BUDGET_LIMIT}
            onChange={(e) => setLocal({ ...local, BUDGET_LIMIT: e.target.value })}
            placeholder="e.g. 0.5 (Leave empty for no limit)"
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
