/**
 * Tests for useLocalStorage and useMRUList hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage, useMRUList } from "../hooks/useLocalStorage";

describe("useLocalStorage hook", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("initialization", () => {
    it("should return default value when localStorage is empty", () => {
      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-key", defaultValue: "default" })
      );

      expect(result.current[0]).toBe("default");
    });

    it("should return stored value from localStorage", () => {
      localStorage.setItem("test-key", JSON.stringify("stored-value"));

      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-key", defaultValue: "default" })
      );

      expect(result.current[0]).toBe("stored-value");
    });

    it("should handle complex objects", () => {
      const storedObject = { name: "test", count: 42 };
      localStorage.setItem("test-object", JSON.stringify(storedObject));

      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-object", defaultValue: { name: "", count: 0 } })
      );

      expect(result.current[0]).toEqual(storedObject);
    });

    it("should handle arrays", () => {
      const storedArray = ["a", "b", "c"];
      localStorage.setItem("test-array", JSON.stringify(storedArray));

      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-array", defaultValue: [] as string[] })
      );

      expect(result.current[0]).toEqual(storedArray);
    });

    it("should use default value when stored JSON is invalid", () => {
      localStorage.setItem("test-key", "not-valid-json{");

      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-key", defaultValue: "default" })
      );

      expect(result.current[0]).toBe("default");
    });
  });

  describe("setValue", () => {
    it("should update state and localStorage", () => {
      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-key", defaultValue: "initial" })
      );

      act(() => {
        result.current[1]("updated");
      });

      expect(result.current[0]).toBe("updated");
      expect(localStorage.getItem("test-key")).toBe(JSON.stringify("updated"));
    });

    it("should support function updater", () => {
      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-counter", defaultValue: 0 })
      );

      act(() => {
        result.current[1]((prev) => prev + 1);
      });

      expect(result.current[0]).toBe(1);

      act(() => {
        result.current[1]((prev) => prev + 5);
      });

      expect(result.current[0]).toBe(6);
    });

    it("should update complex objects", () => {
      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-object", defaultValue: { count: 0 } })
      );

      act(() => {
        result.current[1]({ count: 10 });
      });

      expect(result.current[0]).toEqual({ count: 10 });
      expect(JSON.parse(localStorage.getItem("test-object")!)).toEqual({ count: 10 });
    });
  });

  describe("clearValue", () => {
    it("should clear localStorage and reset to default", () => {
      localStorage.setItem("test-key", JSON.stringify("stored"));

      const { result } = renderHook(() =>
        useLocalStorage({ key: "test-key", defaultValue: "default" })
      );

      expect(result.current[0]).toBe("stored");

      act(() => {
        result.current[2](); // clearValue
      });

      expect(result.current[0]).toBe("default");
      expect(localStorage.getItem("test-key")).toBeNull();
    });
  });

  describe("custom serialization", () => {
    it("should use custom serialize function", () => {
      const customSerialize = vi.fn((value: string) => `custom:${value}`);

      const { result } = renderHook(() =>
        useLocalStorage({
          key: "test-custom",
          defaultValue: "default",
          serialize: customSerialize,
        })
      );

      act(() => {
        result.current[1]("test-value");
      });

      expect(customSerialize).toHaveBeenCalledWith("test-value");
      expect(localStorage.getItem("test-custom")).toBe("custom:test-value");
    });

    it("should use custom deserialize function", () => {
      localStorage.setItem("test-custom", "custom:stored-value");

      const customDeserialize = vi.fn((value: string) => value.replace("custom:", ""));

      const { result } = renderHook(() =>
        useLocalStorage({
          key: "test-custom",
          defaultValue: "default",
          deserialize: customDeserialize,
        })
      );

      expect(customDeserialize).toHaveBeenCalledWith("custom:stored-value");
      expect(result.current[0]).toBe("stored-value");
    });
  });
});

describe("useMRUList hook", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("initialization", () => {
    it("should return empty array by default", () => {
      const { result } = renderHook(() => useMRUList("test-mru"));

      expect(result.current[0]).toEqual([]);
    });

    it("should load stored items", () => {
      localStorage.setItem("test-mru", JSON.stringify(["a", "b", "c"]));

      const { result } = renderHook(() => useMRUList("test-mru"));

      expect(result.current[0]).toEqual(["a", "b", "c"]);
    });
  });

  describe("addItem", () => {
    it("should add new item to front", () => {
      const { result } = renderHook(() => useMRUList("test-mru"));

      act(() => {
        result.current[1]("first");
      });

      expect(result.current[0]).toEqual(["first"]);

      act(() => {
        result.current[1]("second");
      });

      expect(result.current[0]).toEqual(["second", "first"]);
    });

    it("should move existing item to front", () => {
      localStorage.setItem("test-mru", JSON.stringify(["a", "b", "c"]));

      const { result } = renderHook(() => useMRUList("test-mru"));

      act(() => {
        result.current[1]("c");
      });

      expect(result.current[0]).toEqual(["c", "a", "b"]);
    });

    it("should respect maxItems limit", () => {
      const { result } = renderHook(() => useMRUList("test-mru", 3));

      act(() => {
        result.current[1]("a");
        result.current[1]("b");
        result.current[1]("c");
        result.current[1]("d");
      });

      expect(result.current[0]).toEqual(["d", "c", "b"]);
      expect(result.current[0].length).toBe(3);
    });
  });

  describe("removeItem", () => {
    it("should remove specific item", () => {
      localStorage.setItem("test-mru", JSON.stringify(["a", "b", "c"]));

      const { result } = renderHook(() => useMRUList("test-mru"));

      act(() => {
        result.current[2]("b");
      });

      expect(result.current[0]).toEqual(["a", "c"]);
    });

    it("should handle removing non-existent item", () => {
      localStorage.setItem("test-mru", JSON.stringify(["a", "b"]));

      const { result } = renderHook(() => useMRUList("test-mru"));

      act(() => {
        result.current[2]("x");
      });

      expect(result.current[0]).toEqual(["a", "b"]);
    });
  });

  describe("clearAll", () => {
    it("should clear all items", () => {
      localStorage.setItem("test-mru", JSON.stringify(["a", "b", "c"]));

      const { result } = renderHook(() => useMRUList("test-mru"));

      act(() => {
        result.current[3]();
      });

      expect(result.current[0]).toEqual([]);
      expect(localStorage.getItem("test-mru")).toBeNull();
    });
  });
});
