/**
 * Custom hook for GitHub authentication.
 * Encapsulates auth queries and mutations from App.tsx.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { AuthStatus, GitHubEnvironment } from "../types";
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
  /** GitHub environments configured by the backend */
  environments: GitHubEnvironment[];
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
  /** Display name of the active GitHub environment */
  environmentName: string | null;
  /** Stable ID of the active GitHub environment */
  environmentId: string | null;
  /** Web URL of the active GitHub environment */
  webBaseUrl: string;
  /** Function to trigger login */
  startLogin: (environmentId: string) => void;
  /** Re-run OAuth and resolve when the replacement token is stored */
  reauthenticate: (environmentId: string) => Promise<AuthStatus>;
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

  const environmentsQuery = useQuery({
    queryKey: ["github-environments"],
    queryFn: () => invoke<GitHubEnvironment[]>("cmd_list_github_environments"),
    staleTime: Infinity,
    retry: false,
  });

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
    mutationFn: async (environmentId: string) => {
      const status = await invoke<AuthStatus>("cmd_start_github_oauth", {
        environmentId,
      });
      return status;
    },
    onSuccess: (status) => {
      localStorage.setItem("cached-auth-status", JSON.stringify(status));
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await invoke("cmd_logout");
    },
    onSuccess: () => {
      const loggedOutStatus: AuthStatus = {
        is_authenticated: false,
        login: null,
        avatar_url: null,
        is_offline: false,
        environment_id: authQuery.data?.environment_id,
        environment_name: authQuery.data?.environment_name,
        web_base_url: authQuery.data?.web_base_url,
      };
      localStorage.setItem("cached-auth-status", JSON.stringify(loggedOutStatus));
      queryClient.setQueryData<AuthStatus>(AUTH_QUERY_KEY, loggedOutStatus);
      queryClient.removeQueries({ queryKey: ["pull-requests"] });
      queryClient.removeQueries({ queryKey: ["pull-request"] });
      onLogoutSuccess?.();
    },
  });

  return {
    // Auth state
    authStatus: authQuery.data,
    environments: environmentsQuery.data ?? [],
    isLoading: authQuery.isLoading || environmentsQuery.isLoading,
    isError: authQuery.isError || environmentsQuery.isError || loginMutation.isError,
    error: authQuery.error ?? environmentsQuery.error ?? loginMutation.error,
    isAuthenticated: authQuery.data?.is_authenticated === true,
    isOfflineAuth: authQuery.data?.is_offline === true,
    userLogin: authQuery.data?.login ?? null,
    avatarUrl: authQuery.data?.avatar_url ?? null,
    environmentName: authQuery.data?.environment_name ?? null,
    environmentId: authQuery.data?.environment_id ?? null,
    webBaseUrl: authQuery.data?.web_base_url ?? "https://github.com",
    
    // Login
    startLogin: (environmentId: string) => loginMutation.mutate(environmentId),
    reauthenticate: (environmentId: string) => loginMutation.mutateAsync(environmentId),
    isLoggingIn: loginMutation.isPending,
    
    // Logout
    logout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
    
    // Refetch
    refetch: () => authQuery.refetch(),
  };
}

export default useAuth;
