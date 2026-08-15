import type { ReviewResponse } from './api.js';

export type InputModeType = 'pr' | 'path' | 'diff' | 'zip' | 'repo';

export interface HistoryRecord {
  id: string;
  timestamp: number;
  inputMode: InputModeType;
  target: string; // The URL or path or 'Custom Diff'
  result: ReviewResponse;
}

const STORAGE_KEY = 'ai_review_history';
const MAX_HISTORY = 50;

export function saveReviewToHistory(
  inputMode: InputModeType,
  target: string,
  result: ReviewResponse
): void {
  try {
    const existing = getHistory();
    const newRecord: HistoryRecord = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      inputMode,
      target,
      result,
    };
    
    existing.unshift(newRecord);
    
    // Keep only the last MAX_HISTORY items
    if (existing.length > MAX_HISTORY) {
      existing.length = MAX_HISTORY;
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn('Failed to save review to history (possibly quota exceeded):', e);
    // If quota exceeded, try to aggressively clear older items
    try {
      const existing = getHistory();
      if (existing.length > 5) {
        existing.length = 5; // drop down to 5 most recent
        existing.unshift({
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          inputMode,
          target,
          result,
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      }
    } catch (innerErr) {
      console.warn('Still failed after shrinking array:', innerErr);
    }
  }
}

export function getHistory(): HistoryRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as HistoryRecord[];
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function deleteHistoryItem(id: string): void {
  try {
    const existing = getHistory();
    const filtered = existing.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to delete history item:', e);
  }
}
