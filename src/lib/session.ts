// Global KV store — GitHub token & user info (no sessions, no expiry)
// Single-user architecture: one GitHub token stored globally

import { kv } from "./kv.ts";

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  id: number;
}

/** Get the stored GitHub token (from KV or env fallback) */
export async function getGithubToken(): Promise<string> {
  const kvResult = await kv.get<string>(["config", "github_token"]);
  if (kvResult.value) return kvResult.value;
  // deno-lint-ignore no-explicit-any
  return (Deno as any).env.get("GITHUB_TOKEN") ?? "";
}

/** Get the globally stored GitHub user info */
export async function getGlobalGithubUser(): Promise<GitHubUser | null> {
  const result = await kv.get<GitHubUser>(["config", "github_user"]);
  return result.value;
}

/** Store GitHub token and user info globally (from OAuth) */
export async function setGithubConnection(
  token: string,
  user: GitHubUser,
): Promise<void> {
  await kv.set(["config", "github_token"], token);
  await kv.set(["config", "github_user"], user);
}

/** Clear stored GitHub token and user info */
export async function clearGithubConnection(): Promise<void> {
  await kv.delete(["config", "github_token"]);
  await kv.delete(["config", "github_user"]);
}
