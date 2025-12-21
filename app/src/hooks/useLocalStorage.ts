/**
 * Custom hook for localStorage-backed state.
 * Provides a useState-like API with automatic persistence.
 */

import { useState, useCallback } from "react";

export interface UseLocalStorageOptions<T> {
  /** Key to use in localStorage */
  key: string;
  /** Default value if nothing is stored */
  defaultValue: T;
  /** Optional custom serializer (defaults to JSON.stringify) */
  serialize?: (value: T) => string;
  /** Optional custom deserializer (defaults to JSON.parse) */
  deserialize?: (value: string) => T;
}

/**
 * Hook that provides useState-like functionality with localStorage persistence.
 * 
 * @param options Configuration options
 * @returns Tuple of [value, setValue, clearValue]
 * 
 * @example
 * const [theme, setTheme] = useLocalStorage({ key: 'theme', defaultValue: 'light' });
 */
export function useLocalStorage<T>({
  key,
  defaultValue,
  serialize = JSON.stringify,
  deserialize = JSON.parse,
}: UseLocalStorageOptions<T>): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Initialize state from localStorage or default
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }
    try {
      const item = localStorage.getItem(key);
      return item !== null ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Setter that also updates localStorage
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;
        try {
          localStorage.setItem(key, serialize(newValue));
        } catch (error) {
          console.warn(`Error setting localStorage key "${key}":`, error);
        }
        return newValue;
      });
    },
    [key, serialize]
  );

  // Clear function to remove the item
  const clearValue = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setStoredValue(defaultValue);
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  return [storedValue, setValue, clearValue];
}

/**
 * Hook for managing MRU (Most Recently Used) lists with localStorage persistence.
 * 
 * @param key localStorage key
 * @param maxItems Maximum number of items to keep (default: 10)
 * @returns Tuple of [items, addItem, removeItem, clearAll]
 */
export function useMRUList(
  key: string,
  maxItems = 10
): [string[], (item: string) => void, (item: string) => void, () => void] {
  const [items, setItems, clearAll] = useLocalStorage<string[]>({
    key,
    defaultValue: [],
  });

  const addItem = useCallback(
    (item: string) => {
      setItems((prev) => {
        // Move to front and dedupe
        const filtered = prev.filter((i) => i !== item);
        return [item, ...filtered].slice(0, maxItems);
      });
    },
    [setItems, maxItems]
  );

  const removeItem = useCallback(
    (item: string) => {
      setItems((prev) => prev.filter((i) => i !== item));
    },
    [setItems]
  );

  return [items, addItem, removeItem, clearAll];
}

export default useLocalStorage;
