/**
 * Custom hook for GitHub authentication.
 * Encapsulates auth queries and mutations from App.tsx.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { AuthStatus } from "../types";
import { AUTH_QUERY_KEY } from "../constants";

export interface UseAuthOptions {
  /** Callback to mark the app as offline */
  onOffline?: () => void;
  /** Callback to mark the app as online */
  onOnline?: () => void;
  /** Callback when logout succeeds */
  onLogoutSuccess?: () => void;
  /** Whether the network is currently online */
  isOnline?: boolean;
}

export interface UseAuthReturn {
  /** Current authentication status */
  authStatus: AuthStatus | undefined;
  /** Whether the auth query is loading */
  isLoading: boolean;
  /** Whether the auth query has an error */
  isError: boolean;
  /** The auth query error if any */
  error: Error | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether the auth data is from offline cache */
  isOfflineAuth: boolean;
  /** Current user's login name */
  userLogin: string | null;
  /** Current user's avatar URL */
  avatarUrl: string | null;
  /** Function to trigger login */
  startLogin: () => void;
  /** Whether login is in progress */
  isLoggingIn: boolean;
  /** Function to trigger logout */
  logout: () => void;
  /** Whether logout is in progress */
  isLoggingOut: boolean;
  /** Function to refetch auth status */
  refetch: () => void;
}

/**
 * Hook to manage GitHub authentication state.
 * 
 * Features:
 * - Caches auth status in localStorage for instant reload
 * - Supports offline mode with cached credentials
 * - Automatically re-validates when coming back online
 * - Exponential backoff for retries
 */
export function useAuth(options: UseAuthOptions = {}) {
  const { onOffline, onOnline, onLogoutSuccess, isOnline = true } = options;
  const queryClient = useQueryClient();

  const authQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const status = await invoke<AuthStatus>("cmd_check_auth_status");
      
      // Update network status based on authentication result
      if (status.is_offline) {
        onOffline?.();
      } else if (status.is_authenticated) {
        onOnline?.();
      }
      
      // Cache auth status for instant reload
      localStorage.setItem("cached-auth-status", JSON.stringify(status));
      
      return status;
    },
    retry: 3, // Retry up to 3 times for transient network errors
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff, max 5s
    staleTime: 5 * 60 * 1000, // Consider auth status fresh for 5 minutes
    refetchOnWindowFocus: true, // Re-check auth when window regains focus
    refetchOnReconnect: true, // Re-check auth when browser detects network reconnection
    initialData: () => {
      // Load cached auth status immediately
      const cached = localStorage.getItem("cached-auth-status");
      if (cached) {
        try {
          return JSON.parse(cached) as AuthStatus;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  });

  // Re-validate authentication when coming back online
  useEffect(() => {
    if (isOnline && authQuery.data?.is_offline) {
      console.log("🔄 Network back online, re-validating authentication...");
      authQuery.refetch();
    }
  }, [isOnline, authQuery.data?.is_offline]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const status = await invoke<AuthStatus>("cmd_start_github_oauth");
      return status;
    },
    onSuccess: (status) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await invoke("cmd_logout");
    },
    onSuccess: () => {
      queryClient.setQueryData<AuthStatus>(AUTH_QUERY_KEY, {
        is_authenticated: false,
        login: null,
        avatar_url: null,
        is_offline: false,
      });
      queryClient.removeQueries({ queryKey: ["pull-requests"] });
      queryClient.removeQueries({ queryKey: ["pull-request"] });
      onLogoutSuccess?.();
    },
  });

  return {
    // Auth state
    authStatus: authQuery.data,
    isLoading: authQuery.isLoading,
    isError: authQuery.isError,
    error: authQuery.error,
    isAuthenticated: authQuery.data?.is_authenticated === true,
    isOfflineAuth: authQuery.data?.is_offline === true,
    userLogin: authQuery.data?.login ?? null,
    avatarUrl: authQuery.data?.avatar_url ?? null,
    
    // Login
    startLogin: () => loginMutation.mutate(),
    isLoggingIn: loginMutation.isPending,
    
    // Logout
    logout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
    
    // Refetch
    refetch: () => authQuery.refetch(),
  };
}

export default useAuth;
