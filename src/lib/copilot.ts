// Copilot token management — lazy fetch + in-memory cache

const COPILOT_BASE_URLS: Record<string, string> = {
  individual: "https://api.githubcopilot.com",
  business: "https://api.business.githubcopilot.com",
  enterprise: "https://api.enterprise.githubcopilot.com",
};

const EDITOR_VERSION = "vscode/1.99.0";

let cachedToken: string | null = null;
let cachedExpiresAt = 0;

export function copilotBaseUrl(accountType: string): string {
  return COPILOT_BASE_URLS[accountType] ?? COPILOT_BASE_URLS.individual;
}

export function editorVersion(): string {
  return EDITOR_VERSION;
}

export async function getCopilotToken(githubToken: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpiresAt > now + 60) {
    return cachedToken;
  }

  const resp = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      authorization: `token ${githubToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "editor-version": EDITOR_VERSION,
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7",
      "x-github-api-version": "2025-04-01",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Copilot token fetch failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as {
    token: string;
    expires_at: number;
    refresh_in: number;
  };

  cachedToken = data.token;
  cachedExpiresAt = data.expires_at;
  return data.token;
}

// Send a request to the Copilot API (chat/completions)
export async function copilotFetch(
  path: string,
  init: RequestInit,
  githubToken: string,
  accountType: string,
): Promise<Response> {
  const token = await getCopilotToken(githubToken);
  const baseUrl = copilotBaseUrl(accountType);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  headers.set("editor-version", EDITOR_VERSION);
  // Set a realistic user-agent to avoid default Deno/<version>
  headers.set("user-agent", "GitHubCopilotChat/0.26.7");

  const resp = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  return resp;
}
