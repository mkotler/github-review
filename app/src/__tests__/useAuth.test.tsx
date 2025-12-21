/**
 * Tests for useAuth hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useAuth hook", () => {
  beforeEach(() => {
    // Reset all mocks including implementations
    vi.resetAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  describe("initial state", () => {
    it("should return loading state initially", async () => {
      mockInvoke.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAuthenticated).toBe(false);
    });

    it("should eventually load from cache if provided in localStorage", async () => {
      // Note: TanStack Query's initialData function runs synchronously,
      // so we need to set localStorage before creating the wrapper
      const cachedStatus = {
        is_authenticated: true,
        login: "cachedUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: false,
      };
      window.localStorage.setItem("cached-auth-status", JSON.stringify(cachedStatus));

      // Mock invoke to return same data (since initialData is used)
      mockInvoke.mockResolvedValueOnce(cachedStatus);

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      expect(result.current.userLogin).toBe("cachedUser");
      expect(result.current.avatarUrl).toBe("https://example.com/avatar.png");
    });
  });

  describe("authentication flow", () => {
    it("should return authenticated state when auth succeeds", async () => {
      const authStatus = {
        is_authenticated: true,
        login: "testUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: false,
      };

      mockInvoke.mockResolvedValueOnce(authStatus);

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.userLogin).toBe("testUser");
      expect(result.current.avatarUrl).toBe("https://example.com/avatar.png");
      expect(result.current.isOfflineAuth).toBe(false);
    });

    it("should return unauthenticated state when not logged in", async () => {
      const authStatus = {
        is_authenticated: false,
        login: null,
        avatar_url: null,
        is_offline: false,
      };

      mockInvoke.mockResolvedValueOnce(authStatus);

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.userLogin).toBeNull();
    });

    it("should handle offline authentication", async () => {
      const authStatus = {
        is_authenticated: true,
        login: "offlineUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: true,
      };

      const onOffline = vi.fn();
      mockInvoke.mockResolvedValueOnce(authStatus);

      const { result } = renderHook(() => useAuth({ onOffline }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isOfflineAuth).toBe(true);
      expect(onOffline).toHaveBeenCalled();
    });

    it("should call onOnline when auth succeeds online", async () => {
      const authStatus = {
        is_authenticated: true,
        login: "onlineUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: false,
      };

      const onOnline = vi.fn();
      mockInvoke.mockResolvedValueOnce(authStatus);

      const { result } = renderHook(() => useAuth({ onOnline }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(onOnline).toHaveBeenCalled();
    });
  });

  describe("login mutation", () => {
    it("should trigger login when startLogin is called", async () => {
      const initialStatus = {
        is_authenticated: false,
        login: null,
        avatar_url: null,
        is_offline: false,
      };

      const loggedInStatus = {
        is_authenticated: true,
        login: "newUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: false,
      };

      mockInvoke
        .mockResolvedValueOnce(initialStatus) // Initial auth check
        .mockResolvedValueOnce(loggedInStatus); // Login

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);

      // Trigger login
      act(() => {
        result.current.startLogin();
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      expect(mockInvoke).toHaveBeenCalledWith("cmd_start_github_oauth");
      expect(result.current.userLogin).toBe("newUser");
    });
  });

  describe("logout mutation", () => {
    it("should trigger logout when logout is called", async () => {
      const loggedInStatus = {
        is_authenticated: true,
        login: "existingUser",
        avatar_url: "https://example.com/avatar.png",
        is_offline: false,
      };

      mockInvoke
        .mockResolvedValueOnce(loggedInStatus) // Initial auth check
        .mockResolvedValueOnce(undefined); // Logout

      const onLogoutSuccess = vi.fn();

      const { result } = renderHook(() => useAuth({ onLogoutSuccess }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);

      // Trigger logout
      act(() => {
        result.current.logout();
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(mockInvoke).toHaveBeenCalledWith("cmd_logout");
      expect(onLogoutSuccess).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should not be authenticated when auth check fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      // Wait for the query to settle (either error state or loading to finish)
      await waitFor(() => {
        // Just verify that after some time, isAuthenticated is false
        expect(result.current.isAuthenticated).toBe(false);
      }, { timeout: 2000 });
    });
  });

  describe("refetch", () => {
    it("should refetch auth status when refetch is called", async () => {
      const initialStatus = {
        is_authenticated: true,
        login: "user1",
        avatar_url: "https://example.com/avatar1.png",
        is_offline: false,
      };

      const updatedStatus = {
        is_authenticated: true,
        login: "user1",
        avatar_url: "https://example.com/avatar2.png",
        is_offline: false,
      };

      mockInvoke
        .mockResolvedValueOnce(initialStatus)
        .mockResolvedValueOnce(updatedStatus);

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.avatarUrl).toBe("https://example.com/avatar1.png");

      // Trigger refetch
      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.avatarUrl).toBe("https://example.com/avatar2.png");
      });
    });
  });
});
