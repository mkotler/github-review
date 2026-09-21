export const GITHUB_SSO_REQUIRED_EVENT = "github-sso-authorization-required";
export const GITHUB_AUTHENTICATION_REQUIRED_EVENT =
  "github-authentication-required";

export type GitHubSsoAuthorizationDetail = {
  message: string;
  authorizationUrl: string | null;
};

export type GitHubAuthenticationRequiredDetail = {
  message: string;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getSsoAuthorizationDetail(
  error: unknown,
): GitHubSsoAuthorizationDetail | null {
  const message = getErrorMessage(error);
  if (!message.toLowerCase().includes("github sso authorization required")) {
    return null;
  }

  const urlMatch = message.match(/https:\/\/[^\s]+/);
  let authorizationUrl: string | null = null;
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[0]);
      authorizationUrl = parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      authorizationUrl = null;
    }
  }

  return { message, authorizationUrl };
}

export function notifyIfSsoAuthorizationRequired(error: unknown): boolean {
  const detail = getSsoAuthorizationDetail(error);
  if (!detail) {
    return false;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<GitHubSsoAuthorizationDetail>(
        GITHUB_SSO_REQUIRED_EVENT,
        { detail },
      ),
    );
  }
  return true;
}

export function getAuthenticationRequiredDetail(
  error: unknown,
): GitHubAuthenticationRequiredDetail | null {
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();
  if (
    !normalizedMessage.includes("github authentication expired") &&
    !normalizedMessage.includes("bad credentials") &&
    !normalizedMessage.includes("status 401")
  ) {
    return null;
  }

  return { message };
}

export function notifyIfAuthenticationRequired(error: unknown): boolean {
  const detail = getAuthenticationRequiredDetail(error);
  if (!detail) {
    return false;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<GitHubAuthenticationRequiredDetail>(
        GITHUB_AUTHENTICATION_REQUIRED_EVENT,
        { detail },
      ),
    );
  }
  return true;
}

export function shouldRetryGitHubRequest(
  failureCount: number,
  error: unknown,
  maxRetries: number,
): boolean {
  if (notifyIfSsoAuthorizationRequired(error)) {
    return false;
  }
  if (notifyIfAuthenticationRequired(error)) {
    return false;
  }
  return failureCount < maxRetries;
}
