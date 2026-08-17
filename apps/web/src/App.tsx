import { useState } from 'react';
import { Code, Settings, History, Wrench, Menu, X, Activity } from 'lucide-react';
import { ReviewView } from './ReviewView.js';
import { SettingsView } from './SettingsView.js';
import { SkillsView } from './SkillsView.js';
import { HistoryView } from './HistoryView.js';
import { HowItWorksView } from './HowItWorksView.js';
import { useAppConfig } from './Settings.js';

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState('howitworks');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [config] = useAppConfig();

  const tabs = [
    { id: 'howitworks', label: 'How It Works', icon: Activity },
    { id: 'review', label: 'Code Review', icon: Code },
    { id: 'skills', label: 'Skills & Rules', icon: Wrench },
    { id: 'history', label: 'History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="dashboard-layout">
      {/* Mobile Header */}
      <div className="mobile-header">
        <h2>AI Review</h2>
        <button className="icon-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <h2>AI Review</h2>
          <span className="version">v1.0</span>
        </div>

        {config.BUDGET_LIMIT && (
          <div style={{ padding: '0 1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max Budget</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>${parseFloat(config.BUDGET_LIMIT).toFixed(2)}</span>
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileMenuOpen(false);
                }}
              >
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {activeTab === 'howitworks' && <HowItWorksView />}
        {activeTab === 'review' && <ReviewView />}
        {activeTab === 'skills' && <SkillsView />}
        {activeTab === 'history' && <HistoryView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>
      
      {/* Backdrop for mobile */}
      {isMobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
    </div>
  );
}
