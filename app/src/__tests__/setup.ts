// Test Setup - Vitest Configuration
// This file runs before each test file

import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock Tauri event API
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock localStorage with working implementation
function createLocalStorageMock() {
  const store: Record<string, string> = {};
  
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { Object.keys(store).forEach(k => delete store[k]); },
    get length(): number { return Object.keys(store).length; },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
  };
}

let localStorageMock = createLocalStorageMock();

Object.defineProperty(window, 'localStorage', {
  get() { return localStorageMock; },
  configurable: true,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  // Reset localStorage to a fresh instance
  localStorageMock = createLocalStorageMock();
});

afterEach(() => {
  localStorageMock = createLocalStorageMock();
});
