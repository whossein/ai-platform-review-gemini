import { useState, useEffect } from 'react';
import { Trash2, Calendar, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, History, Cpu, Zap } from 'lucide-react';
import { getHistory, clearHistory, deleteHistoryItem } from './history.js';
import type { HistoryRecord } from './history.js';
import type { ReviewIssue } from './api.js';

function IssueItem({ issue }: { issue: ReviewIssue }) {
  return (
    <div style={{ padding: '0.75rem', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--border)', marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : issue.severity === 'medium' ? '🟡' : issue.severity === 'low' ? '🔵' : '⚪'}
          {issue.title}
        </strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'var(--panel)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
          {issue.location.file}:{issue.location.line ?? '*'}
        </span>
      </div>
      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text)' }}>{issue.description}</p>
      {issue.suggestion && (
        <div style={{ background: 'var(--panel)', padding: '0.5rem', borderRadius: '4px', borderLeft: '3px solid var(--accent)' }}>
          <strong style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>Suggestion:</strong>
          <pre style={{ margin: '0.25rem 0 0 0', whiteSpace: 'pre-wrap', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            {issue.suggestion.description}
          </pre>
        </div>
      )}
    </div>
  );
}

function HistoryCard({ record, onDelete }: { record: HistoryRecord, onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(record.timestamp);
  
  return (
    <div className="settings-card" style={{ background: 'var(--panel)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        
        <div style={{ flex: 1, minWidth: '250px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ 
              background: record.inputMode === 'pr' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
              color: record.inputMode === 'pr' ? '#3b82f6' : '#10b981',
              padding: '0.2rem 0.6rem', 
              borderRadius: '20px', 
              fontSize: '0.75rem', 
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              {record.inputMode}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Calendar size={14} /> {date.toLocaleDateString()} {date.toLocaleTimeString()}
            </span>
          </div>
          
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', wordBreak: 'break-all' }}>
            {record.target}
          </h3>
          
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.9rem', color: 'var(--muted)', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
              {record.result.total} Issues Found
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <CheckCircle size={14} style={{ color: 'var(--low)' }} />
              {record.result.accepted} Accepted
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Cpu size={14} />
              {record.model || 'Unknown Model'}
            </span>
            {record.result.metrics && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Zap size={14} style={{ color: '#eab308' }} />
                {(record.result.metrics.totalPromptTokens + record.result.metrics.totalCompletionTokens).toLocaleString()} Tokens
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            className="secondary-button" 
            onClick={() => setExpanded(!expanded)}
            style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {expanded ? 'Hide Details' : 'View Details'}
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          <button 
            onClick={onDelete}
            style={{ 
              background: 'transparent', 
              border: '1px solid var(--error)', 
              color: 'var(--error)', 
              padding: '0.5rem', 
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Delete record"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h4 style={{ margin: 0 }}>Review Findings</h4>
          </div>
          
          {record.result.issues.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No issues found in this review.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {record.result.issues.map((issue, idx) => (
                <IssueItem key={`${issue.id}-${idx}`} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HistoryView() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  function handleClearAll() {
    if (confirm('Are you sure you want to clear all review history?')) {
      clearHistory();
      setHistory([]);
    }
  }

  function handleDelete(id: string) {
    deleteHistoryItem(id);
    setHistory(history.filter(h => h.id !== id));
  }

  const totalTokens = history.reduce((sum, record) => {
    if (record.result.metrics) {
      return sum + record.result.metrics.totalPromptTokens + record.result.metrics.totalCompletionTokens;
    }
    return sum;
  }, 0);

  return (
    <div className="view-container" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <header className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Review History</h2>
          <p>Past code reviews and analysis results saved locally.</p>
        </div>
        
        {history.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--panel)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem' }}>
              <Zap size={16} style={{ color: '#eab308' }} />
              <span><strong style={{ color: 'var(--text)' }}>{totalTokens.toLocaleString()}</strong> Tokens Used</span>
            </div>
            <button 
              onClick={handleClearAll}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                background: 'transparent', 
                color: 'var(--error)', 
                border: '1px solid var(--error)' 
              }}
            >
              <Trash2 size={16} />
              Clear All
            </button>
          </div>
        )}
      </header>

      <div style={{ marginTop: '2rem' }}>
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--panel)', borderRadius: '12px', border: '1px dashed var(--border)' }}>
            <History size={48} style={{ margin: '0 auto', color: 'var(--muted)', marginBottom: '1rem' }} />
            <h3>No history yet</h3>
            <p style={{ color: 'var(--muted)' }}>Run a code review to see it saved here.</p>
          </div>
        ) : (
          history.map(record => (
            <HistoryCard key={record.id} record={record} onDelete={() => handleDelete(record.id)} />
          ))
        )}
      </div>
    </div>
  );
}
