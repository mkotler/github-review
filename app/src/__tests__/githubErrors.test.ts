import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_AUTHENTICATION_REQUIRED_EVENT,
  GITHUB_SSO_REQUIRED_EVENT,
  getAuthenticationRequiredDetail,
  getSsoAuthorizationDetail,
  shouldRetryGitHubRequest,
} from "../utils/githubErrors";

describe("GitHub error handling", () => {
  it("extracts an SSO authorization URL", () => {
    const detail = getSsoAuthorizationDetail(
      "GitHub SSO authorization required. Visit https://msft.ghe.com/enterprises/msft/sso?authorization_request=abc to approve this application.",
    );

    expect(detail?.authorizationUrl).toBe(
      "https://msft.ghe.com/enterprises/msft/sso?authorization_request=abc",
    );
  });

  it("does not retry SSO authorization failures", () => {
    const listener = vi.fn();
    window.addEventListener(GITHUB_SSO_REQUIRED_EVENT, listener);

    expect(
      shouldRetryGitHubRequest(
        0,
        "GitHub SSO authorization required. Visit https://msft.ghe.com/sso.",
        3,
      ),
    ).toBe(false);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(GITHUB_SSO_REQUIRED_EVENT, listener);
  });

  it("detects expired or rejected credentials", () => {
    expect(
      getAuthenticationRequiredDetail(
        "get pull request failed with status 401. Bad credentials",
      ),
    ).toEqual({
      message: "get pull request failed with status 401. Bad credentials",
    });
  });

  it("does not retry authentication failures", () => {
    const listener = vi.fn();
    window.addEventListener(GITHUB_AUTHENTICATION_REQUIRED_EVENT, listener);

    expect(
      shouldRetryGitHubRequest(
        0,
        new Error(
          "GitHub authentication expired or is no longer valid. Sign in again.",
        ),
        3,
      ),
    ).toBe(false);
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(GITHUB_AUTHENTICATION_REQUIRED_EVENT, listener);
  });

  it("retains normal retry behavior for transient failures", () => {
    expect(shouldRetryGitHubRequest(1, new Error("timeout"), 3)).toBe(true);
    expect(shouldRetryGitHubRequest(3, new Error("timeout"), 3)).toBe(false);
  });
});
