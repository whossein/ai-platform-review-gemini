import { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Star, 
  Pencil, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle,
  Save,
  RotateCcw,
  Eye, 
  EyeOff, 
  Download, 
  Upload, 
  Globe, 
  Key, 
  Cpu, 
  ShieldCheck,
  DollarSign,
  X
} from 'lucide-react';
import { useAppConfig } from './Settings.js';
import type { AIProviderConfig, AppConfig } from './Settings.js';
import { requestTestProvider, type TestProviderResult } from './api.js';

const PRESET_DEFAULTS: Record<string, {
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  defaultInputCost: number;
  defaultOutputCost: number;
}> = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-flash',
    requiresKey: true,
    defaultInputCost: 0.075,
    defaultOutputCost: 0.30,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    defaultInputCost: 0.15,
    defaultOutputCost: 0.60,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
    requiresKey: true,
    defaultInputCost: 0.80,
    defaultOutputCost: 4.00,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    requiresKey: true,
    defaultInputCost: 3.00,
    defaultOutputCost: 15.00,
  },
  ollama: {
    label: 'Ollama (Local / Free)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder',
    requiresKey: false,
    defaultInputCost: 0,
    defaultOutputCost: 0,
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
    defaultInputCost: 0.14,
    defaultOutputCost: 0.28,
  },
  azure: {
    label: 'Azure OpenAI',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    defaultInputCost: 0.15,
    defaultOutputCost: 0.60,
  },
  custom: {
    label: 'Custom / Proxy Gateway',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    requiresKey: false,
    defaultInputCost: 0.15,
    defaultOutputCost: 0.60,
  },
};

interface TestState {
  loading: boolean;
  result?: TestProviderResult;
}

export function SettingsView() {
  const [config, setConfig] = useAppConfig();
  const [local, setLocal] = useState<AppConfig>(config);
  const [saved, setSaved] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  
  const [showKeyNew, setShowKeyNew] = useState(false);
  const [showKeyEdit, setShowKeyEdit] = useState(false);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AIProviderConfig | null>(null);

  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [newProvider, setNewProvider] = useState<AIProviderConfig>({
    id: '',
    provider: 'gemini',
    apiKey: '',
    model: '',
    baseUrl: '',
    tier: 'cheap',
    inputCostPer1M: PRESET_DEFAULTS.gemini.defaultInputCost,
    outputCostPer1M: PRESET_DEFAULTS.gemini.defaultOutputCost,
  });

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(local) !== JSON.stringify(config);
  }, [local, config]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleSave = () => {
    setConfig(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleDiscard = () => {
    setLocal(config);
    setEditingProviderId(null);
    setEditForm(null);
  };

  const handleTest = async (
    testKey: string,
    pConfig: { provider: string; apiKey?: string; model?: string; baseUrl?: string }
  ) => {
    setTestStates(prev => ({ ...prev, [testKey]: { loading: true } }));
    try {
      const res = await requestTestProvider({
        provider: pConfig.provider,
        apiKey: pConfig.apiKey,
        model: pConfig.model,
        baseUrl: pConfig.baseUrl,
      });
      setTestStates(prev => ({ ...prev, [testKey]: { loading: false, result: res } }));
    } catch (err: any) {
      setTestStates(prev => ({
        ...prev,
        [testKey]: {
          loading: false,
          result: { ok: false, error: err.message || 'Connection test failed' },
        },
      }));
    }
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
    
    setNewProvider({
      id: '',
      provider: 'gemini',
      apiKey: '',
      model: '',
      baseUrl: '',
      tier: 'cheap',
      inputCostPer1M: PRESET_DEFAULTS.gemini.defaultInputCost,
      outputCostPer1M: PRESET_DEFAULTS.gemini.defaultOutputCost,
    });
    setShowKeyNew(false);
  };

  const handleStartEdit = (p: AIProviderConfig) => {
    setEditingProviderId(p.id);
    setEditForm({ ...p });
    setShowKeyEdit(false);
  };

  const handleCancelEdit = () => {
    setEditingProviderId(null);
    setEditForm(null);
    setShowKeyEdit(false);
  };

  const handleSaveEdit = () => {
    if (!editForm) return;
    const providers = (local.AI_PROVIDERS || []).map(p => (p.id === editForm.id ? editForm : p));
    setLocal({
      ...local,
      AI_PROVIDERS: providers,
    });
    setEditingProviderId(null);
    setEditForm(null);
  };

  const handleDeleteProvider = (id: string) => {
    const providers = (local.AI_PROVIDERS || []).filter(p => p.id !== id);
    let nextDefault = local.AI_REVIEW_LLM_PROVIDER;
    if (local.AI_REVIEW_LLM_PROVIDER === id) {
      nextDefault = providers.length > 0 ? providers[0].id : 'gemini';
    }
    setLocal({
      ...local,
      AI_PROVIDERS: providers,
      AI_REVIEW_LLM_PROVIDER: nextDefault,
    });
  };

  const handleSetDefaultProvider = (providerId: string) => {
    setLocal({ ...local, AI_REVIEW_LLM_PROVIDER: providerId });
  };

  const handleExportConfig = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(local, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ai-review-settings-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (event.target.files && event.target.files[0]) {
      fileReader.readAsText(event.target.files[0], "UTF-8");
      fileReader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (parsed && typeof parsed === 'object') {
            const updated = { ...local, ...parsed };
            setLocal(updated);
            setConfig(updated);
            setImportStatus('✓ Settings successfully restored from backup file!');
            setTimeout(() => setImportStatus(null), 4000);
          }
        } catch {
          setImportStatus('✗ Failed to parse JSON file.');
          setTimeout(() => setImportStatus(null), 4000);
        }
      };
    }
  };

  return (
    <div className="settings-view" style={{ maxWidth: '680px', margin: '0 auto' }}>
      <header className="view-header" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--text)' }}>Configuration & AI Providers</h1>
        <p style={{ color: 'var(--muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
          Manage your AI models, API keys, endpoints, and persistent settings.
        </p>
      </header>

      {/* Unsaved Changes Top Alert */}
      {hasUnsavedChanges && (
        <div style={{
          background: 'rgba(234, 179, 8, 0.12)',
          border: '1px solid rgba(234, 179, 8, 0.45)',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          boxShadow: '0 4px 12px rgba(234, 179, 8, 0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'rgba(234, 179, 8, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <AlertTriangle size={20} style={{ color: '#eab308' }} />
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.95rem' }}>
                هشدار: تغییرات ذخیره نشده دارید (Unsaved Changes)
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                اطلاعات ویرایش شده‌اند. لطفاً روی دکمه ذخیره کلیک کنید تا تنظیمات در سیستم ثبت شوند.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleDiscard}
              className="secondary-button"
              style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <RotateCcw size={14} /> بازنشانی (Discard)
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                backgroundColor: 'var(--accent)',
                color: '#fff',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)'
              }}
            >
              <Save size={15} /> ذخیره تنظیمات (Save)
            </button>
          </div>
        </div>
      )}

      {/* Test Mode Card */}
      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.25rem 1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', color: 'var(--text)' }}>Test Mode (Offline Mock Agent)</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
              Run the full review pipeline entirely offline without API keys or costs.
            </p>
          </div>
          <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', flexShrink: 0 }}>
            <input 
              type="checkbox" 
              checked={local.AI_REVIEW_LLM_PROVIDER === 'mock'}
              onChange={(e) => {
                setLocal({
                  ...local,
                  AI_REVIEW_LLM_PROVIDER: e.target.checked ? 'mock' : (local.AI_PROVIDERS?.[0]?.id || 'gemini')
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

      {/* AI Providers Section */}
      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', opacity: local.AI_REVIEW_LLM_PROVIDER === 'mock' ? 0.6 : 1, marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', margin: 0, color: 'var(--text)' }}>AI Providers</h2>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Configure provider credentials, custom base URLs, and test connectivity.
            </p>
          </div>
        </div>

        {/* List of Configured Providers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          {(local.AI_PROVIDERS || []).map((p) => {
            const isDefault = local.AI_REVIEW_LLM_PROVIDER === p.id;
            const isEditing = editingProviderId === p.id;
            const preset = PRESET_DEFAULTS[p.provider] || PRESET_DEFAULTS.custom;
            const effectiveUrl = p.baseUrl || preset.baseUrl || '(No base URL)';
            const effectiveModel = p.model || preset.defaultModel;
            const testState = testStates[p.id];

            if (isEditing && editForm) {
              const editPreset = PRESET_DEFAULTS[editForm.provider] || PRESET_DEFAULTS.custom;
              const editTestState = testStates[`edit-${editForm.id}`];

              return (
                <div 
                  key={p.id} 
                  style={{ 
                    border: '2px solid var(--accent)', 
                    borderRadius: '10px', 
                    padding: '1.25rem', 
                    background: 'rgba(0, 0, 0, 0.02)' 
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Pencil size={16} color="var(--accent)" />
                      <span>Edit Provider: {editPreset.label}</span>
                    </div>
                    <button 
                      onClick={handleCancelEdit} 
                      style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                      title="Cancel Edit"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="form-group">
                    <label>Provider Platform</label>
                    <select
                      value={editForm.provider}
                      onChange={(e) => {
                        const newP = e.target.value;
                        setEditForm({ 
                          ...editForm, 
                          provider: newP,
                          baseUrl: editForm.baseUrl || PRESET_DEFAULTS[newP]?.baseUrl || ''
                        });
                      }}
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="ollama">Ollama (Local / Free)</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="azure">Azure OpenAI</option>
                      <option value="custom">Custom / Third-party Proxy</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>API Key / Token</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showKeyEdit ? 'text' : 'password'}
                        value={editForm.apiKey}
                        onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                        placeholder={editForm.provider === 'ollama' ? "Not required for Ollama" : "Paste API Token (Defaults to env if empty)"}
                        disabled={editForm.provider === 'ollama'}
                        style={{ paddingRight: '2.5rem' }}
                      />
                      {editForm.provider !== 'ollama' && (
                        <button
                          type="button"
                          onClick={() => setShowKeyEdit(!showKeyEdit)}
                          style={{
                            position: 'absolute',
                            right: '0.5rem',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--muted)',
                            cursor: 'pointer',
                            padding: '0.25rem',
                          }}
                        >
                          {showKeyEdit ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Model Name</label>
                      <input
                        type="text"
                        value={editForm.model}
                        onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                        placeholder={`Default: ${editPreset.defaultModel}`}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Tier / Speed</label>
                      <select
                        value={editForm.tier || 'mid'}
                        onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })}
                      >
                        <option value="cheap">Cheap (Fast / Low Cost)</option>
                        <option value="mid">Medium (Balanced)</option>
                        <option value="premium">Premium (High Quality)</option>
                        <option value="local">Local (Offline / Free)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Input Cost ($ / 1M tokens)</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={editForm.inputCostPer1M ?? ''}
                        onChange={(e) => setEditForm({ 
                          ...editForm, 
                          inputCostPer1M: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                        })}
                        placeholder={`Default: $${editPreset.defaultInputCost}`}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <label>Output Cost ($ / 1M tokens)</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={editForm.outputCostPer1M ?? ''}
                        onChange={(e) => setEditForm({ 
                          ...editForm, 
                          outputCostPer1M: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                        })}
                        placeholder={`Default: $${editPreset.defaultOutputCost}`}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                    <label>Base URL (Gateway / Endpoint URL)</label>
                    <input
                      type="text"
                      value={editForm.baseUrl}
                      onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                      placeholder={editPreset.baseUrl || "e.g. https://api.openai.com/v1 or api.gapgpt.app/v1"}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      Tip: Both <code>https://api.gapgpt.app/v1</code> and <code>api.gapgpt.app/v1</code> are supported. <code>/chat/completions</code> is appended automatically.
                    </div>
                  </div>

                  {editTestState?.result && (
                    <div 
                      style={{ 
                        marginTop: '0.75rem', 
                        padding: '0.6rem 0.8rem', 
                        borderRadius: '6px', 
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: editTestState.result.ok ? 'rgba(46, 213, 115, 0.1)' : 'rgba(255, 71, 87, 0.1)',
                        color: editTestState.result.ok ? 'var(--low)' : 'var(--critical)',
                        border: `1px solid ${editTestState.result.ok ? 'rgba(46, 213, 115, 0.3)' : 'rgba(255, 71, 87, 0.3)'}`
                      }}
                    >
                      {editTestState.result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                      <span>
                        {editTestState.result.ok 
                          ? `✓ Connected (${editTestState.result.latencyMs}ms) — Model: ${editTestState.result.model}`
                          : `✗ Connection Error: ${editTestState.result.error}`}
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={() => handleTest(`edit-${editForm.id}`, editForm)}
                      disabled={editTestState?.loading}
                      className="secondary-button"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}
                    >
                      <Activity size={15} />
                      {editTestState?.loading ? 'Testing...' : 'Test Connection'}
                    </button>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="secondary-button"
                        style={{ padding: '0.5rem 0.8rem', fontSize: '0.85rem' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div 
                key={p.id} 
                style={{ 
                  border: isDefault ? '2px solid var(--accent)' : '1px solid var(--border)', 
                  borderRadius: '10px', 
                  background: 'var(--panel)',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  boxShadow: isDefault ? '0 0 0 1px var(--accent)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)' }}>
                      {preset.label || p.provider}
                    </span>
                    {p.tier && (
                      <span style={{ fontSize: '0.75rem', background: 'var(--border)', color: 'var(--text)', padding: '0.15rem 0.5rem', borderRadius: '4px', textTransform: 'capitalize' }}>
                        {p.tier}
                      </span>
                    )}
                    {isDefault && (
                      <span style={{ fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 500 }}>
                        Active Default
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    {!isDefault && (
                      <button 
                        onClick={() => handleSetDefaultProvider(p.id)}
                        title="Set as Active Default Provider"
                        style={{ padding: '0.4rem', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                      >
                        <Star size={18} />
                      </button>
                    )}
                    <button 
                      onClick={() => handleStartEdit(p)}
                      title="Edit Provider & Tokens"
                      style={{ padding: '0.4rem', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer' }}
                    >
                      <Pencil size={17} />
                    </button>
                    <button 
                      onClick={() => handleDeleteProvider(p.id)}
                      title="Delete Provider"
                      style={{ padding: '0.4rem', background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer' }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>

                {/* Provider URL & Model Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', wordBreak: 'break-all' }}>
                    <Globe size={14} style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text)' }}>
                      {effectiveUrl}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Cpu size={14} />
                      <span>Model: <strong style={{ color: 'var(--text)' }}>{effectiveModel}</strong></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Key size={14} />
                      <span>
                        {p.apiKey ? (
                          <span style={{ fontFamily: 'monospace' }}>
                            Key: {p.apiKey.slice(0, 4)}••••{p.apiKey.slice(-4)}
                          </span>
                        ) : p.provider === 'ollama' ? (
                          'No Key Required'
                        ) : (
                          'Using Server Env Key'
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <DollarSign size={14} style={{ color: 'var(--accent)' }} />
                      <span>
                        Pricing: {p.provider === 'ollama' ? 'Free (Local)' : `$${p.inputCostPer1M ?? preset.defaultInputCost} in / $${p.outputCostPer1M ?? preset.defaultOutputCost} out per 1M`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Test Result Message */}
                {testState?.result && (
                  <div 
                    style={{ 
                      padding: '0.5rem 0.75rem', 
                      borderRadius: '6px', 
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: testState.result.ok ? 'rgba(46, 213, 115, 0.1)' : 'rgba(255, 71, 87, 0.1)',
                      color: testState.result.ok ? 'var(--low)' : 'var(--critical)',
                      border: `1px solid ${testState.result.ok ? 'rgba(46, 213, 115, 0.3)' : 'rgba(255, 71, 87, 0.3)'}`
                    }}
                  >
                    {testState.result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>
                      {testState.result.ok 
                        ? `✓ Connected (${testState.result.latencyMs}ms) — Model: ${testState.result.model}`
                        : `✗ ${testState.result.error}`}
                    </span>
                  </div>
                )}

                {/* Action Bar for Card */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: '0.25rem' }}>
                  <button
                    onClick={() => handleTest(p.id, p)}
                    disabled={testState?.loading}
                    className="secondary-button"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.4rem', 
                      fontSize: '0.8rem', 
                      padding: '0.35rem 0.75rem',
                      background: 'rgba(0, 0, 0, 0.03)'
                    }}
                  >
                    <Activity size={14} />
                    {testState?.loading ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>
            );
          })}

          {(!local.AI_PROVIDERS || local.AI_PROVIDERS.length === 0) && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
              No AI providers configured. Add one below.
            </div>
          )}
        </div>

        {/* Add New Provider Section */}
        <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border)', padding: '1.25rem', borderRadius: '10px' }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text)' }}>
            <Plus size={16} />
            <span>Add New Provider</span>
          </h3>

          <div className="form-group">
            <label>Provider Platform</label>
            <select
              value={newProvider.provider}
              onChange={(e) => {
                const pName = e.target.value;
                setNewProvider({ 
                  ...newProvider, 
                  provider: pName,
                  baseUrl: PRESET_DEFAULTS[pName]?.baseUrl || '',
                });
              }}
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (Local / Free)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="azure">Azure OpenAI</option>
              <option value="custom">Custom / Third-party Proxy</option>
            </select>
          </div>

          <div className="form-group">
            <label>API Key / Token</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKeyNew ? 'text' : 'password'}
                value={newProvider.apiKey}
                onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                placeholder={newProvider.provider === 'ollama' ? "Not required for Ollama" : "Paste API Token (Defaults to env if empty)"}
                disabled={newProvider.provider === 'ollama'}
                style={{ paddingRight: '2.5rem' }}
              />
              {newProvider.provider !== 'ollama' && (
                <button
                  type="button"
                  onClick={() => setShowKeyNew(!showKeyNew)}
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    padding: '0.25rem',
                  }}
                >
                  {showKeyNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Model Name (Optional)</label>
              <input
                type="text"
                value={newProvider.model}
                onChange={(e) => setNewProvider({ ...newProvider, model: e.target.value })}
                placeholder={`Default: ${PRESET_DEFAULTS[newProvider.provider]?.defaultModel || 'gpt-4o-mini'}`}
              />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Tier / Speed</label>
              <select
                value={newProvider.tier || 'mid'}
                onChange={(e) => setNewProvider({ ...newProvider, tier: e.target.value })}
              >
                <option value="cheap">Cheap (Fast / Low Cost)</option>
                <option value="mid">Medium (Balanced)</option>
                <option value="premium">Premium (High Quality)</option>
                <option value="local">Local (Offline / Free)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Input Cost ($ / 1M tokens)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={newProvider.inputCostPer1M ?? ''}
                onChange={(e) => setNewProvider({ 
                  ...newProvider, 
                  inputCostPer1M: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                })}
                placeholder={`Default: $${PRESET_DEFAULTS[newProvider.provider]?.defaultInputCost ?? 0.15}`}
              />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Output Cost ($ / 1M tokens)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={newProvider.outputCostPer1M ?? ''}
                onChange={(e) => setNewProvider({ 
                  ...newProvider, 
                  outputCostPer1M: e.target.value === '' ? undefined : parseFloat(e.target.value) 
                })}
                placeholder={`Default: $${PRESET_DEFAULTS[newProvider.provider]?.defaultOutputCost ?? 0.60}`}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            <label>Base URL (Endpoint URL)</label>
            <input
              type="text"
              value={newProvider.baseUrl}
              onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
              placeholder={PRESET_DEFAULTS[newProvider.provider]?.baseUrl || "e.g. https://api.openai.com/v1 or api.gapgpt.app/v1"}
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
              Tip: Both <code>https://api.gapgpt.app/v1</code> and <code>api.gapgpt.app/v1</code> are supported. <code>/chat/completions</code> is appended automatically.
            </div>
          </div>

          {testStates['new-provider']?.result && (
            <div 
              style={{ 
                marginTop: '0.75rem', 
                padding: '0.6rem 0.8rem', 
                borderRadius: '6px', 
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: testStates['new-provider'].result.ok ? 'rgba(46, 213, 115, 0.1)' : 'rgba(255, 71, 87, 0.1)',
                color: testStates['new-provider'].result.ok ? 'var(--low)' : 'var(--critical)',
                border: `1px solid ${testStates['new-provider'].result.ok ? 'rgba(46, 213, 115, 0.3)' : 'rgba(255, 71, 87, 0.3)'}`
              }}
            >
              {testStates['new-provider'].result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>
                {testStates['new-provider'].result.ok 
                  ? `✓ Connected (${testStates['new-provider'].result.latencyMs}ms) — Model: ${testStates['new-provider'].result.model}`
                  : `✗ Connection Error: ${testStates['new-provider'].result.error}`}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button 
              type="button"
              onClick={() => handleTest('new-provider', newProvider)} 
              disabled={testStates['new-provider']?.loading}
              className="secondary-button"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}
            >
              <Activity size={16} />
              {testStates['new-provider']?.loading ? 'Testing...' : 'Test Connection'}
            </button>
            <button 
              type="button"
              onClick={handleAddProvider} 
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1.25rem' }}
            >
              <Plus size={16} /> Add to Providers
            </button>
          </div>
        </div>
      </div>

      {/* Git Provider Settings */}
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

      {/* Budget & Limits */}
      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Budget & Limits</h2>
        <div className="form-group" style={{ marginBottom: 0 }}>
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

      {/* Data Persistence & Backup Card */}
      <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <ShieldCheck size={20} color="var(--accent)" />
          <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text)' }}>Data Persistence & Backup</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: '1.5' }}>
          تمام تنظیمات، توکن‌ها و پروایدرهای شما به‌صورت پایدار در حافظه سیستم (Local Storage) ذخیره می‌شوند و با بیلد یا به‌روزرسانی نسخه‌های بعدی برنامه پاک نمی‌شوند. همچنین می‌توانید یک نسخه پشتیبان JSON از تنظیمات خود دریافت یا بارگذاری کنید.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button 
            type="button" 
            onClick={handleExportConfig}
            className="secondary-button"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
          >
            <Download size={15} /> Export Backup (JSON)
          </button>
          
          <button 
            type="button" 
            onClick={() => fileInputRef.current?.click()}
            className="secondary-button"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
          >
            <Upload size={15} /> Import Backup (JSON)
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportConfig} 
            accept=".json" 
            style={{ display: 'none' }} 
          />
        </div>

        {importStatus && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: importStatus.startsWith('✓') ? 'var(--low)' : 'var(--critical)' }}>
            {importStatus}
          </div>
        )}
      </div>

      {/* Sticky Floating Bar for Unsaved Changes */}
      {hasUnsavedChanges && (
        <div style={{
          position: 'sticky',
          bottom: '1.25rem',
          zIndex: 50,
          background: 'var(--panel)',
          border: '1px solid rgba(234, 179, 8, 0.6)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
          borderRadius: '12px',
          padding: '0.85rem 1.25rem',
          marginTop: '1.5rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          backdropFilter: 'blur(12px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#eab308',
              boxShadow: '0 0 8px #eab308'
            }} />
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
              تغییرات ذخیره نشده دارید! لطفاً برای اعمال تغییرات ذخیره کنید.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleDiscard}
              className="secondary-button"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <RotateCcw size={14} /> بازنشانی
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '0.45rem 1.1rem',
                fontSize: '0.85rem',
                backgroundColor: 'var(--accent)',
                color: '#fff',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 10px rgba(99, 102, 241, 0.4)'
              }}
            >
              <Save size={15} /> ذخیره تغییرات
            </button>
          </div>
        </div>
      )}

      {/* Save Button Section */}
      <div className="form-actions" style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button 
          onClick={handleSave} 
          style={{ 
            padding: '0.75rem 1.75rem', 
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            position: 'relative'
          }}
        >
          <Save size={18} />
          Save Configuration
        </button>

        {hasUnsavedChanges && (
          <span style={{ 
            color: '#eab308', 
            fontSize: '0.85rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.35rem',
            background: 'rgba(234, 179, 8, 0.1)',
            padding: '0.35rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid rgba(234, 179, 8, 0.3)'
          }}>
            <AlertTriangle size={15} /> تغییرات ذخیره نشده دارید
          </span>
        )}

        {saved && (
          <span style={{ 
            color: 'var(--low)', 
            fontSize: '0.9rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.35rem',
            background: 'rgba(74, 222, 128, 0.1)',
            padding: '0.35rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid rgba(74, 222, 128, 0.3)'
          }}>
            <CheckCircle2 size={16} /> Saved successfully / ذخیره شد
          </span>
        )}
      </div>
    </div>
  );
}
