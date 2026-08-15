import { useState } from 'react';
import { Code, Settings, History, Wrench, Menu, X } from 'lucide-react';
import { ReviewView } from './ReviewView.js';
import { SettingsView } from './SettingsView.js';
import { SkillsView } from './SkillsView.js';
import { HistoryView } from './HistoryView.js';

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState('review');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const tabs = [
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
