// Dashboard page — three-tab layout: Upstream / API Keys / Usage
// All API calls authenticated via x-api-key header from localStorage

import { html } from "hono/html";
import { Layout } from "./layout.tsx";

export function DashboardPage() {
  return Layout({
    title: "Dashboard",
    children: html`
      <div class="min-h-screen" x-data="dashboardApp()" x-init="init()">
        <!-- Top ambient glow -->
        <div class="fixed top-0 left-1/4 w-[500px] h-[300px] bg-accent-cyan/3 rounded-full blur-[100px] pointer-events-none"></div>
        <div class="fixed top-0 right-1/4 w-[400px] h-[250px] bg-accent-emerald/3 rounded-full blur-[100px] pointer-events-none"></div>

        <!-- Header -->
        <header class="border-b border-white/5 bg-surface-900/80 backdrop-blur-md sticky top-0 z-50">
          <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-surface-700 glow-border flex items-center justify-center">
                <svg class="w-4 h-4 text-accent-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <span class="font-semibold text-white text-sm tracking-tight">Copilot Gateway</span>
            </div>
            <button @click="logout()" class="btn-ghost text-xs">Logout</button>
          </div>

          <!-- Tab bar -->
          <div class="max-w-6xl mx-auto px-6 pb-3">
            <nav class="flex gap-1 bg-surface-800 rounded-lg p-0.5 w-fit">
              <template x-if="isAdmin">
                <button @click="switchTab('upstream')"
                  class="px-4 py-2 rounded-md text-sm font-medium transition-all"
                  :class="tab === 'upstream' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                  Upstream
                </button>
              </template>
              <button @click="switchTab('keys')"
                class="px-4 py-2 rounded-md text-sm font-medium transition-all"
                :class="tab === 'keys' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                API Keys
              </button>
              <button @click="switchTab('usage')"
                class="px-4 py-2 rounded-md text-sm font-medium transition-all"
                :class="tab === 'usage' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                Usage
              </button>
            </nav>
          </div>
        </header>

        <main class="max-w-6xl mx-auto px-6 py-8">

          <!-- ===================== TAB: UPSTREAM (admin only) ===================== -->
          <template x-if="isAdmin">
          <div x-show="tab === 'upstream'" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100">

            <!-- GitHub Connection Banner -->
            <template x-if="!githubConnected">
              <div class="glass-card p-6 mb-8 glow-border animate-in flex items-center justify-between">
                <div>
                  <h3 class="text-white font-medium mb-1">Connect GitHub Account</h3>
                  <p class="text-sm text-gray-400">Link your GitHub account to use Copilot API with your own token.</p>
                </div>
                <button @click="startGithubAuth()" class="btn-primary" :disabled="deviceFlow.loading">
                  <span x-show="!deviceFlow.loading">Connect GitHub</span>
                  <span x-show="deviceFlow.loading">Connecting...</span>
                </button>
              </div>
            </template>

            <!-- Device Flow Modal -->
            <template x-if="deviceFlow.userCode">
              <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in">
                <div class="glass-card p-8 max-w-md w-full mx-4 glow-cyan">
                  <h3 class="text-white text-lg font-semibold mb-2">GitHub Authorization</h3>
                  <p class="text-gray-400 text-sm mb-6">Enter this code on GitHub to authorize:</p>

                  <div class="bg-surface-900 rounded-xl p-6 text-center mb-6 glow-border">
                    <code class="text-3xl font-mono font-bold text-accent-cyan tracking-[0.3em]" x-text="deviceFlow.userCode"></code>
                  </div>

                  <a :href="deviceFlow.verificationUri" target="_blank"
                     class="btn-primary w-full block text-center mb-4">
                    Open GitHub
                  </a>

                  <div class="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                    </svg>
                    Waiting for authorization...
                  </div>

                  <button @click="cancelDeviceFlow()" class="btn-ghost w-full mt-4">Cancel</button>
                </div>
              </div>
            </template>

            <!-- Stats Grid -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
              <!-- Premium Requests -->
              <div class="glass-card p-6 hover-lift animate-in delay-1">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">Premium Requests</span>
                  <div class="w-2 h-2 rounded-full status-pulse"
                       :class="usageData ? (usagePercent > 90 ? 'bg-accent-rose' : usagePercent > 70 ? 'bg-accent-amber' : 'bg-accent-emerald') : 'bg-gray-600'"></div>
                </div>
                <template x-if="usageData">
                  <div>
                    <div class="flex items-baseline gap-2 mb-3">
                      <span class="text-3xl font-bold text-white font-mono" x-text="usageData.quota_snapshots.premium_interactions.entitlement - usageData.quota_snapshots.premium_interactions.remaining"></span>
                      <span class="text-sm text-gray-500">/ <span x-text="usageData.quota_snapshots.premium_interactions.entitlement"></span></span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill"
                           :class="usagePercent > 90 ? 'bg-accent-rose' : usagePercent > 70 ? 'bg-gradient-to-r from-accent-amber to-accent-rose' : 'bg-gradient-to-r from-accent-cyan to-accent-emerald'"
                           :style="'width:' + usagePercent + '%'"></div>
                    </div>
                    <p class="text-xs text-gray-500 mt-2">
                      <span x-text="usageData.quota_snapshots.premium_interactions.remaining"></span> remaining
                      · Resets <span x-text="formatDate(usageData.quota_reset_date)"></span>
                    </p>
                  </div>
                </template>
                <template x-if="!usageData && !usageError">
                  <div class="space-y-2">
                    <div class="h-8 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-2 bg-surface-600 rounded animate-pulse"></div>
                  </div>
                </template>
                <template x-if="usageError">
                  <p class="text-sm text-gray-500">Unable to load</p>
                </template>
              </div>

              <!-- Chat Completions -->
              <div class="glass-card p-6 hover-lift animate-in delay-2">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">Chat Quota</span>
                  <svg class="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <template x-if="usageData">
                  <div>
                    <div class="flex items-baseline gap-2 mb-1">
                      <span class="text-2xl font-bold text-white font-mono"
                            x-text="usageData.quota_snapshots.chat.unlimited ? '\u221e' : usageData.quota_snapshots.chat.remaining"></span>
                      <span class="text-xs text-gray-500" x-show="!usageData.quota_snapshots.chat.unlimited">remaining</span>
                      <span class="text-xs text-accent-emerald" x-show="usageData.quota_snapshots.chat.unlimited">unlimited</span>
                    </div>
                    <p class="text-xs text-gray-500">
                      Plan: <span class="text-gray-300" x-text="usageData.copilot_plan"></span>
                    </p>
                  </div>
                </template>
                <template x-if="!usageData">
                  <div class="h-8 bg-surface-600 rounded animate-pulse"></div>
                </template>
              </div>

              <!-- Completions -->
              <div class="glass-card p-6 hover-lift animate-in delay-3">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">Completions</span>
                  <svg class="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 18 22 12 16 6"/>
                    <polyline points="8 6 2 12 8 18"/>
                  </svg>
                </div>
                <template x-if="usageData">
                  <div>
                    <div class="flex items-baseline gap-2 mb-1">
                      <span class="text-2xl font-bold text-white font-mono"
                            x-text="usageData.quota_snapshots.completions.unlimited ? '\u221e' : usageData.quota_snapshots.completions.remaining"></span>
                      <span class="text-xs text-gray-500" x-show="!usageData.quota_snapshots.completions.unlimited">remaining</span>
                      <span class="text-xs text-accent-emerald" x-show="usageData.quota_snapshots.completions.unlimited">unlimited</span>
                    </div>
                    <p class="text-xs text-gray-500">Code completions</p>
                  </div>
                </template>
                <template x-if="!usageData">
                  <div class="h-8 bg-surface-600 rounded animate-pulse"></div>
                </template>
              </div>
            </div>

            <!-- Info Cards -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <!-- Account Info -->
              <div class="glass-card p-6 animate-in delay-4">
                <h3 class="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Account</h3>
                <template x-if="user">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                      <img :src="user.avatar_url" class="w-12 h-12 rounded-xl ring-2 ring-white/5" />
                      <div>
                        <p class="text-white font-medium" x-text="user.name || user.login"></p>
                        <p class="text-sm text-gray-500" x-text="'@' + user.login"></p>
                      </div>
                    </div>
                    <button @click="disconnectGithub()" class="btn-ghost text-xs">Disconnect</button>
                  </div>
                </template>
                <template x-if="!user && githubConnected">
                  <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-surface-600 animate-pulse"></div>
                    <div class="space-y-2">
                      <div class="h-4 w-32 bg-surface-600 rounded animate-pulse"></div>
                      <div class="h-3 w-24 bg-surface-600 rounded animate-pulse"></div>
                    </div>
                  </div>
                </template>
                <template x-if="!githubConnected">
                  <p class="text-sm text-gray-500">No GitHub account connected</p>
                </template>
              </div>

              <!-- API Info -->
              <div class="glass-card p-6 animate-in delay-5">
                <h3 class="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">API Endpoints</h3>
                <div class="space-y-3 font-mono text-xs">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-accent-emerald/10 text-accent-emerald text-[10px] font-bold">POST</span>
                    <span class="text-gray-300">/v1/chat/completions</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-accent-emerald/10 text-accent-emerald text-[10px] font-bold">POST</span>
                    <span class="text-gray-300">/v1/messages</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-accent-emerald/10 text-accent-emerald text-[10px] font-bold">POST</span>
                    <span class="text-gray-300">/v1/responses</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-accent-emerald/10 text-accent-emerald text-[10px] font-bold">POST</span>
                    <span class="text-gray-300">/v1/embeddings</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan text-[10px] font-bold">GET</span>
                    <span class="text-gray-300">/v1/models</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </template>

          <!-- ===================== TAB: API KEYS ===================== -->
          <div x-show="tab === 'keys'">

            <!-- Key Management -->
            <div class="glass-card p-6 mb-6 animate-in">
              <div class="flex items-center justify-between mb-6">
                <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">API Keys</span>
                <div class="flex items-center gap-2" x-show="isAdmin">
                  <input type="text" x-model="newKeyName" placeholder="Name" class="!text-xs !py-1.5 !px-3 !w-32 !rounded-lg" @keydown.enter="createNewKey()" />
                  <button @click="createNewKey()" class="btn-primary !text-xs !py-1.5 !px-3 !rounded-lg whitespace-nowrap" :disabled="!newKeyName.trim() || keyCreating">
                    <span x-show="!keyCreating">+ Create</span>
                    <span x-show="keyCreating">...</span>
                  </button>
                </div>
              </div>

              <!-- New Key Result -->
              <template x-if="newKeyResult">
                <div class="mb-6 p-4 rounded-xl bg-accent-emerald/5 border border-accent-emerald/20 animate-in">
                  <div class="flex items-center gap-2 mb-2">
                    <svg class="w-4 h-4 text-accent-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    <span class="text-sm font-medium text-accent-emerald">New key for <span x-text="newKeyResult.name"></span></span>
                  </div>
                  <div class="flex items-center gap-2 mb-2">
                    <code class="flex-1 text-xs font-mono text-gray-300 bg-surface-900 rounded-lg px-3 py-2 break-all select-all" x-text="newKeyResult.key"></code>
                    <button @click="copySnippet(newKeyResult.key, 'key')" class="btn-ghost text-xs px-3 py-2 shrink-0">
                      <span x-text="copied === 'key' ? 'Copied!' : 'Copy'"></span>
                    </button>
                  </div>
                  <p class="text-xs text-accent-amber">Save this key now — it won't be shown again.</p>
                  <button @click="newKeyResult = null" class="btn-ghost text-xs mt-2">Dismiss</button>
                </div>
              </template>

              <!-- Key List -->
              <div class="overflow-x-auto">
                <template x-if="keys.length === 0 && !keysLoading">
                  <p class="text-sm text-gray-500 py-4 text-center">No API keys yet. Create one above.</p>
                </template>
                <template x-if="keysLoading && keys.length === 0">
                  <div class="space-y-3 py-2">
                    <div class="h-10 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-10 bg-surface-600 rounded animate-pulse"></div>
                  </div>
                </template>
                <template x-if="keys.length > 0">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-white/5">
                        <th class="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-widest">Name</th>
                        <th class="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-widest">Key</th>
                        <th class="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-widest">Created</th>
                        <th x-show="isAdmin" class="text-right py-2 text-xs font-medium text-gray-500 uppercase tracking-widest">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template x-for="k in keys" :key="k.id">
                        <tr class="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          <td class="py-3 pr-4">
                            <span class="text-white font-medium" x-text="k.name"></span>
                          </td>
                          <td class="py-3 pr-4">
                            <code class="text-xs font-mono text-gray-500 bg-surface-800 rounded px-2 py-1" x-text="'...' + k.key_hint"></code>
                          </td>
                          <td class="py-3 pr-4">
                            <span class="text-gray-500 text-xs" x-text="formatDate(k.created_at)"></span>
                          </td>
                          <td x-show="isAdmin" class="py-3 text-right">
                            <div class="flex items-center justify-end gap-1">
                              <button @click="rotateKeyById(k.id, k.name)" class="text-gray-600 hover:text-accent-amber transition-colors p-1" :disabled="keyRotating === k.id" title="Rotate key">
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M21.5 2v6h-6"/>
                                  <path d="M2.5 22v-6h6"/>
                                  <path d="M2.5 12a10 10 0 0 1 16.5-5.7L21.5 8"/>
                                  <path d="M21.5 12a10 10 0 0 1-16.5 5.7L2.5 16"/>
                                </svg>
                              </button>
                              <button @click="deleteKeyById(k.id, k.name)" class="text-gray-600 hover:text-accent-rose transition-colors p-1" :disabled="keyDeleting === k.id" title="Delete key">
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </template>
              </div>
            </div>

            <!-- Configuration Guide -->
            <div class="glass-card p-6 animate-in delay-1">
              <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">Configuration</span>
              <template x-if="newKeyResult">
                <p class="text-xs text-accent-cyan mt-2 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  Configs below use your newly created key. Copy them before dismissing.
                </p>
              </template>

              <!-- Loading skeleton -->
              <template x-if="!modelsLoaded">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                  <div class="space-y-3">
                    <div class="h-5 w-28 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-7 w-40 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-32 bg-surface-600 rounded-xl animate-pulse"></div>
                  </div>
                  <div class="space-y-3">
                    <div class="h-5 w-20 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-7 w-40 bg-surface-600 rounded animate-pulse"></div>
                    <div class="h-32 bg-surface-600 rounded-xl animate-pulse"></div>
                  </div>
                </div>
              </template>

              <template x-if="modelsLoaded">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                  <!-- Claude Code -->
                  <div>
                    <div class="mb-3">
                      <span class="text-sm font-semibold text-white">Claude Code</span>
                    </div>

                    <!-- Model selectors -->
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                      <div class="flex items-center gap-2">
                        <label class="text-xs text-gray-500">Model:</label>
                        <select x-model="claudeModel"
                          class="text-xs font-mono bg-surface-800 text-gray-300 border border-white/10 rounded-lg px-2 py-1.5 outline-none focus:border-accent-cyan/50 cursor-pointer">
                          <template x-for="m in claudeModelsBig" :key="m">
                            <option :value="m" x-text="m"></option>
                          </template>
                        </select>
                      </div>
                      <div class="flex items-center gap-2">
                        <label class="text-xs text-gray-500">Small/fast:</label>
                        <select x-model="claudeSmallModel"
                          class="text-xs font-mono bg-surface-800 text-gray-300 border border-white/10 rounded-lg px-2 py-1.5 outline-none focus:border-accent-cyan/50 cursor-pointer">
                          <template x-for="m in claudeModelsSmall" :key="m">
                            <option :value="m" x-text="m"></option>
                          </template>
                        </select>
                      </div>
                    </div>

                    <p class="text-[11px] text-gray-600 mb-2">Add to <code class="text-gray-500">~/.bashrc</code>, <code class="text-gray-500">~/.zshrc</code>, or equivalent</p>
                    <div class="relative group">
                      <pre class="bg-surface-900 rounded-xl p-4 pr-10 overflow-x-auto border border-white/[0.04]"><code class="language-bash" x-ref="claudeCode" x-effect="$el.textContent = claudeCodeSnippet(); Prism.highlightElement($el)"></code></pre>
                      <button @click="copySnippet(claudeCodeSnippet(), 'claude')"
                        class="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-surface-700/80 text-gray-500 hover:text-accent-cyan hover:bg-surface-600 transition-all opacity-0 group-hover:opacity-100"
                        :title="copied === 'claude' ? 'Copied!' : 'Copy'">
                        <svg x-show="copied !== 'claude'" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <svg x-show="copied === 'claude'" class="w-3.5 h-3.5 text-accent-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                    </div>
                  </div>

                  <!-- Codex -->
                  <div>
                    <div class="mb-3">
                      <span class="text-sm font-semibold text-white">Codex</span>
                    </div>

                    <!-- Model selector -->
                    <div class="flex items-center gap-2 mb-3">
                      <label class="text-xs text-gray-500">Model:</label>
                      <select x-model="codexModel"
                        class="text-xs font-mono bg-surface-800 text-gray-300 border border-white/10 rounded-lg px-2 py-1.5 outline-none focus:border-accent-cyan/50 cursor-pointer">
                        <template x-for="m in codexModels" :key="m">
                          <option :value="m" x-text="m"></option>
                        </template>
                      </select>
                    </div>

                    <p class="text-[11px] text-gray-600 mb-2">Add to <code class="text-gray-500">~/.codex/config.toml</code></p>
                    <div class="relative group">
                      <pre class="bg-surface-900 rounded-xl p-4 pr-10 overflow-x-auto border border-white/[0.04]"><code class="language-toml" x-ref="codexCode" x-effect="$el.textContent = codexSnippet(); Prism.highlightElement($el)"></code></pre>
                      <button @click="copySnippet(codexSnippet(), 'codex')"
                        class="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-surface-700/80 text-gray-500 hover:text-accent-cyan hover:bg-surface-600 transition-all opacity-0 group-hover:opacity-100"
                        :title="copied === 'codex' ? 'Copied!' : 'Copy'">
                        <svg x-show="copied !== 'codex'" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <svg x-show="copied === 'codex'" class="w-3.5 h-3.5 text-accent-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                    </div>

                    <p class="text-[11px] text-gray-600 mt-4 mb-2">Add to <code class="text-gray-500">~/.bashrc</code>, <code class="text-gray-500">~/.zshrc</code>, or equivalent</p>
                    <div class="relative group">
                      <pre class="bg-surface-900 rounded-xl p-4 pr-10 overflow-x-auto border border-white/[0.04]"><code class="language-bash" x-ref="codexEnv" x-effect="$el.textContent = codexEnvSnippet(); Prism.highlightElement($el)"></code></pre>
                      <button @click="copySnippet(codexEnvSnippet(), 'codexEnv')"
                        class="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-surface-700/80 text-gray-500 hover:text-accent-cyan hover:bg-surface-600 transition-all opacity-0 group-hover:opacity-100"
                        :title="copied === 'codexEnv' ? 'Copied!' : 'Copy'">
                        <svg x-show="copied !== 'codexEnv'" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <svg x-show="copied === 'codexEnv'" class="w-3.5 h-3.5 text-accent-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- ===================== TAB: USAGE ===================== -->
          <div x-show="tab === 'usage'">
            <div class="glass-card p-6 animate-in">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div class="flex items-center gap-3">
                  <span class="text-xs font-medium text-gray-500 uppercase tracking-widest">Token Usage</span>
                  <template x-if="tokenLoading">
                    <svg class="animate-spin h-3.5 w-3.5 text-gray-500" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                    </svg>
                  </template>
                </div>
                <div class="flex items-center gap-1 bg-surface-800 rounded-lg p-0.5">
                  <button @click="switchTokenRange('today')"
                    class="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                    :class="tokenRange === 'today' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                    Today
                  </button>
                  <button @click="switchTokenRange('7d')"
                    class="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                    :class="tokenRange === '7d' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                    7 Days
                  </button>
                  <button @click="switchTokenRange('30d')"
                    class="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                    :class="tokenRange === '30d' ? 'bg-surface-600 text-white' : 'text-gray-500 hover:text-gray-300'">
                    30 Days
                  </button>
                </div>
              </div>

              <div style="height: 320px; position: relative;">
                <canvas id="tokenChart"></canvas>
              </div>

              <!-- Summary stats -->
              <div class="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-white/5">
                <div class="text-center">
                  <p class="text-xs text-gray-500 mb-1">Requests</p>
                  <p class="text-lg font-bold font-mono text-white" x-text="tokenSummary.requests.toLocaleString()"></p>
                </div>
                <div class="text-center">
                  <p class="text-xs text-gray-500 mb-1">Input Tokens</p>
                  <p class="text-lg font-bold font-mono text-white" x-text="tokenSummary.input.toLocaleString()"></p>
                </div>
                <div class="text-center">
                  <p class="text-xs text-gray-500 mb-1">Output Tokens</p>
                  <p class="text-lg font-bold font-mono text-white" x-text="tokenSummary.output.toLocaleString()"></p>
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>

      <style>
        select option { background: #13181f; color: #e0e0e0; }
      </style>

      <script>
        function dashboardApp() {
          const role = localStorage.getItem('role') || 'admin';
          const isAdmin = role === 'admin';
          const TABS = isAdmin ? ['upstream', 'keys', 'usage'] : ['keys', 'usage'];
          const defaultTab = isAdmin ? 'upstream' : 'keys';
          const initTab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : defaultTab;

          // Claude tier order: opus=0, sonnet=1, haiku=2
          const CLAUDE_TIER = { opus: 0, sonnet: 1, haiku: 2 };
          function claudeTier(id) {
            for (const t in CLAUDE_TIER) { if (id.includes(t)) return CLAUDE_TIER[t]; }
            return 99;
          }
          // Big model sort: opus first, within tier reverse alpha (larger version first)
          function sortClaudeBig(a, b) {
            const ta = claudeTier(a), tb = claudeTier(b);
            return ta !== tb ? ta - tb : b.localeCompare(a);
          }
          // Small model sort: haiku first, within tier reverse alpha
          function sortClaudeSmall(a, b) {
            const ta = claudeTier(a), tb = claudeTier(b);
            return ta !== tb ? tb - ta : b.localeCompare(a);
          }
          // Codex sort: non-mini first, within group reverse alpha
          function sortCodex(a, b) {
            const am = a.includes('mini') ? 1 : 0;
            const bm = b.includes('mini') ? 1 : 0;
            return am !== bm ? am - bm : b.localeCompare(a);
          }

          return {
            accessKey: '',
            role,
            isAdmin,
            tab: initTab,

            // Upstream
            user: null,
            githubConnected: false,
            usageData: null,
            usageError: false,
            usagePercent: 0,
            deviceFlow: { loading: false, userCode: null, verificationUri: null, deviceCode: null, pollTimer: null },

            // Keys
            keys: [],
            keysLoading: false,
            newKeyName: '',
            newKeyResult: null,
            keyCreating: false,
            keyDeleting: null,
            keyRotating: null,
            copied: false,

            // Config — no defaults, populated by loadModels
            modelsLoaded: false,
            claudeModelsBig: [],
            claudeModelsSmall: [],
            claudeModel: '',
            claudeSmallModel: '',
            codexModels: [],
            codexModel: '',

            // Token usage
            tokenRange: 'today',
            tokenData: [],
            tokenChart: null,
            tokenLoading: false,
            tokenSummary: { requests: 0, input: 0, output: 0 },

            get baseUrl() { return location.origin; },

            get activeKey() { return this.isAdmin ? (this.newKeyResult?.key || '<your-api-key>') : this.accessKey; },

            claudeCodeSnippet() {
              const lines = [
                'export ANTHROPIC_BASE_URL=' + this.baseUrl,
                'export ANTHROPIC_AUTH_TOKEN=' + this.activeKey,
                'export ANTHROPIC_MODEL=' + this.claudeModel,
                'export ANTHROPIC_SMALL_FAST_MODEL=' + this.claudeSmallModel,
              ];
              return lines.join('\\n');
            },

            codexSnippet() {
              const lines = [
                'model = "' + this.codexModel + '"',
                'model_provider = "copilot_gateway"',
                '',
                '[model_providers.copilot_gateway]',
                'name = "Copilot Gateway"',
                'base_url = "' + this.baseUrl + '/"',
                'env_key = "COPILOT_GATEWAY_API_KEY"',
                'wire_api = "responses"',
              ];
              return lines.join('\\n');
            },

            codexEnvSnippet() {
              return 'export COPILOT_GATEWAY_API_KEY=' + this.activeKey;
            },

            init() {
              this.accessKey = localStorage.getItem('access_key') || '';
              if (!this.accessKey) { window.location.href = '/'; return; }

              if (this.isAdmin) {
                this.loadMe();
                this.loadUsage();
              }
              this.loadModels();
              this.loadKeys().then(() => {
                if (this.tab === 'usage') this.loadTokenUsage();
                else this.fetchTokenData();
              });

              setInterval(() => {
                if (this.isAdmin) this.loadUsage();
                if (this.tab === 'usage') this.loadTokenUsage();
              }, 60000);

              window.addEventListener('hashchange', () => {
                const h = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : defaultTab;
                if (this.tab !== h) this.switchTab(h);
              });
            },

            authHeaders() { return { 'x-api-key': this.accessKey }; },

            async switchTab(t) {
              if (t !== 'usage' && this.tokenChart) {
                this.tokenChart.stop();
                this.tokenChart.destroy();
                this.tokenChart = null;
              }
              this.tab = t;
              location.hash = '#' + t;
              if (t === 'usage') {
                await this.loadKeys();
                await this.loadTokenUsage();
              } else if (t === 'keys') {
                await this.loadKeys();
              }
            },

            // ---- Models ----

            async loadModels() {
              try {
                const resp = await fetch('/v1/models', { headers: this.authHeaders() });
                if (!resp.ok) return;
                const { data } = await resp.json();

                const claudeAll = data
                  .filter(m => m.id.startsWith('claude-') && m.supported_endpoints?.includes('/v1/messages'))
                  .map(m => m.id);

                this.claudeModelsBig = [...claudeAll].sort(sortClaudeBig);
                this.claudeModelsSmall = [...claudeAll].sort(sortClaudeSmall);
                this.claudeModel = this.claudeModelsBig[0] || '';
                this.claudeSmallModel = this.claudeModelsSmall[0] || '';

                this.codexModels = data
                  .filter(m => m.supported_endpoints?.includes('/responses'))
                  .map(m => m.id)
                  .sort(sortCodex);
                this.codexModel = this.codexModels[0] || '';

                this.modelsLoaded = true;
              } catch {}
            },

            // ---- Upstream ----

            async loadMe() {
              try {
                const resp = await fetch('/auth/me', { headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                const data = await resp.json();
                this.githubConnected = data.github_connected;
                this.user = data.user;
              } catch (e) { console.error('loadMe:', e); }
            },

            async loadUsage() {
              try {
                const resp = await fetch('/api/usage', { headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                if (resp.ok) {
                  this.usageData = await resp.json();
                  const pi = this.usageData.quota_snapshots.premium_interactions;
                  this.usagePercent = pi.entitlement > 0
                    ? Math.round(((pi.entitlement - pi.remaining) / pi.entitlement) * 100) : 0;
                  this.usageError = false;
                } else { this.usageError = true; }
              } catch { this.usageError = true; }
            },

            formatDate(s) {
              return s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            },

            async startGithubAuth() {
              this.deviceFlow.loading = true;
              try {
                const resp = await fetch('/auth/github', { headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                const d = await resp.json();
                if (d.user_code) {
                  Object.assign(this.deviceFlow, { userCode: d.user_code, verificationUri: d.verification_uri, deviceCode: d.device_code });
                  this.pollDeviceFlow(d.interval || 5);
                }
              } catch (e) { console.error('startGithubAuth:', e); }
              finally { this.deviceFlow.loading = false; }
            },

            pollDeviceFlow(interval) {
              this.deviceFlow.pollTimer = setInterval(async () => {
                try {
                  const resp = await fetch('/auth/github/poll', {
                    method: 'POST',
                    headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_code: this.deviceFlow.deviceCode }),
                  });
                  if (resp.status === 401) { this.kickToLogin(); return; }
                  const d = await resp.json();
                  if (d.status === 'complete') {
                    this.cancelDeviceFlow();
                    this.user = d.user;
                    this.githubConnected = true;
                    await this.loadUsage();
                  } else if (d.status === 'slow_down') {
                    clearInterval(this.deviceFlow.pollTimer);
                    this.pollDeviceFlow((d.interval || interval) + 1);
                  } else if (d.status === 'error') {
                    this.cancelDeviceFlow();
                    alert('Authorization failed: ' + d.error);
                  }
                } catch (e) { console.error('poll:', e); }
              }, interval * 1000);
            },

            cancelDeviceFlow() {
              clearInterval(this.deviceFlow.pollTimer);
              Object.assign(this.deviceFlow, { pollTimer: null, userCode: null, verificationUri: null, deviceCode: null });
            },

            async disconnectGithub() {
              if (!confirm('Disconnect GitHub account? You will need to reconnect to use Copilot API.')) return;
              try {
                await fetch('/auth/github/disconnect', { method: 'POST', headers: this.authHeaders() });
                this.githubConnected = false;
                this.user = null;
                this.usageData = null;
                this.usageError = false;
                this.usagePercent = 0;
              } catch (e) { console.error('disconnectGithub:', e); }
            },

            // ---- Key management ----

            async loadKeys() {
              this.keysLoading = true;
              try {
                const resp = await fetch('/api/keys', { headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                if (resp.ok) this.keys = await resp.json();
              } catch (e) { console.error('loadKeys:', e); }
              finally { this.keysLoading = false; }
            },

            async createNewKey() {
              const name = this.newKeyName.trim();
              if (!name) return;
              this.keyCreating = true;
              try {
                const resp = await fetch('/api/keys', {
                  method: 'POST',
                  headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                });
                if (resp.status === 401) { this.kickToLogin(); return; }
                if (resp.ok) {
                  this.newKeyResult = await resp.json();
                  this.newKeyName = '';
                  await this.loadKeys();
                } else {
                  alert((await resp.json()).error || 'Failed to create key');
                }
              } catch (e) { console.error('createKey:', e); }
              finally { this.keyCreating = false; }
            },

            async deleteKeyById(id, name) {
              if (!confirm('Delete key "' + name + '"? This cannot be undone.')) return;
              this.keyDeleting = id;
              try {
                await fetch('/api/keys/' + id, { method: 'DELETE', headers: this.authHeaders() });
                if (this.newKeyResult && this.newKeyResult.id === id) this.newKeyResult = null;
                await this.loadKeys();
              } catch (e) { console.error('deleteKey:', e); }
              finally { this.keyDeleting = null; }
            },

            async rotateKeyById(id, name) {
              if (!confirm('Rotate key "' + name + '"? The old key will stop working immediately.')) return;
              this.keyRotating = id;
              try {
                const resp = await fetch('/api/keys/' + id + '/rotate', { method: 'POST', headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                if (resp.ok) {
                  this.newKeyResult = await resp.json();
                  await this.loadKeys();
                } else {
                  alert((await resp.json()).error || 'Failed to rotate key');
                }
              } catch (e) { console.error('rotateKey:', e); }
              finally { this.keyRotating = null; }
            },

            async copySnippet(text, tag) {
              try { await navigator.clipboard.writeText(text); }
              catch {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              }
              this.copied = tag;
              setTimeout(() => { this.copied = false; }, 2000);
            },

            // ---- Token usage ----

            localHourKey(d) {
              const p = n => String(n).padStart(2, '0');
              return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours());
            },
            localDateKey(d) {
              const p = n => String(n).padStart(2, '0');
              return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
            },

            async fetchTokenData() {
              this.tokenLoading = true;
              try {
                const now = new Date();
                const rangeStart = new Date(now);
                if (this.tokenRange === 'today') rangeStart.setHours(0,0,0,0);
                else if (this.tokenRange === '7d') { rangeStart.setDate(rangeStart.getDate()-6); rangeStart.setHours(0,0,0,0); }
                else { rangeStart.setDate(rangeStart.getDate()-29); rangeStart.setHours(0,0,0,0); }
                const start = rangeStart.toISOString().slice(0,13);
                const end = new Date(now.getTime()+3600000).toISOString().slice(0,13);
                const resp = await fetch('/api/token-usage?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end), { headers: this.authHeaders() });
                if (resp.status === 401) { this.kickToLogin(); return; }
                if (resp.ok) this.tokenData = await resp.json();
              } catch (e) { console.error('fetchTokenData:', e); }
              finally { this.tokenLoading = false; }
            },

            async loadTokenUsage() {
              await this.fetchTokenData();
              if (this.tab !== 'usage') return;
              await this.$nextTick();
              this.renderTokenChart();
            },

            renderTokenChart() {
              const canvas = document.getElementById('tokenChart');
              if (!canvas || canvas.clientWidth === 0) return;

              const palette = ['#00e5ff','#00e676','#ffd740','#ff5252','#7c4dff','#ff6e40','#64ffda','#eeff41','#40c4ff','#ea80fc'];
              const isDaily = this.tokenRange !== 'today';
              const data = this.tokenData;

              const keyNameMap = new Map([['admin', 'admin']]);
              for (const k of this.keys) keyNameMap.set(k.id, k.name);

              let totalReqs = 0, totalIn = 0, totalOut = 0;
              for (const r of data) { totalReqs += r.requests; totalIn += r.inputTokens; totalOut += r.outputTokens; }
              this.tokenSummary = { requests: totalReqs, input: totalIn, output: totalOut };

              const bucketMap = new Map();
              const now = new Date();
              if (this.tokenRange === 'today') {
                for (let h = 0; h < 24; h++) {
                  const d = new Date(now); d.setHours(h,0,0,0);
                  bucketMap.set(this.localHourKey(d), String(h).padStart(2,'0') + ':00 \\u2013 ' + String((h+1)%24).padStart(2,'0') + ':00');
                }
              } else {
                const days = this.tokenRange === '7d' ? 7 : 30;
                for (let i = days-1; i >= 0; i--) {
                  const d = new Date(now); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
                  bucketMap.set(this.localDateKey(d), d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                }
              }

              const keyIds = new Set();
              const agg = new Map();
              for (const [key] of bucketMap) agg.set(key, new Map());
              for (const r of data) {
                const utc = new Date(r.hour + ':00:00Z');
                const bucket = isDaily ? this.localDateKey(utc) : this.localHourKey(utc);
                if (!agg.has(bucket)) continue;
                keyIds.add(r.keyId);
                const m = agg.get(bucket);
                m.set(r.keyId, (m.get(r.keyId)||0) + r.inputTokens + r.outputTokens);
              }

              const keyList = [...keyIds].sort((a,b) => (keyNameMap.get(a)||a).localeCompare(keyNameMap.get(b)||b));
              const labels = [...bucketMap.values()];
              const bucketKeys = [...bucketMap.keys()];
              const datasets = keyList.map((keyId, i) => {
                const c = palette[i % palette.length];
                return {
                  label: keyNameMap.get(keyId) || keyId.slice(0,8),
                  data: bucketKeys.map(k => agg.get(k)?.get(keyId) || 0),
                  borderColor: c, backgroundColor: c + '18',
                  borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, fill: true,
                };
              });

              if (this.tokenChart) { this.tokenChart.stop(); this.tokenChart.destroy(); this.tokenChart = null; }

              this.tokenChart = new Chart(canvas, {
                type: 'line', data: { labels, datasets },
                options: {
                  responsive: true, maintainAspectRatio: false, animation: false,
                  interaction: { mode: 'index', intersect: false },
                  plugins: {
                    legend: { position: 'bottom', labels: { color: '#9e9e9e', font: { size: 11, family: "'DM Sans', sans-serif" }, boxWidth: 12, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                    tooltip: {
                      backgroundColor: 'rgba(12,16,21,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
                      titleColor: '#e0e0e0', bodyColor: '#b0bec5', padding: 12,
                      bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
                      callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString() + ' tokens' }
                    }
                  },
                  scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#9e9e9e', font: { size: 10, family: "'DM Sans', sans-serif" }, maxRotation: 45 }, border: { color: 'rgba(255,255,255,0.06)' } },
                    y: {
                      beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' },
                      ticks: { color: '#9e9e9e', font: { size: 10, family: "'JetBrains Mono', monospace" },
                        callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v },
                      border: { color: 'rgba(255,255,255,0.06)' }
                    }
                  }
                }
              });
            },

            switchTokenRange(range) { this.tokenRange = range; this.loadTokenUsage(); },

            // ---- Common ----
            logout() { localStorage.removeItem('access_key'); localStorage.removeItem('role'); localStorage.removeItem('login_key_id'); localStorage.removeItem('login_key_name'); localStorage.removeItem('login_key_hint'); window.location.href = '/'; },
            kickToLogin() { localStorage.removeItem('access_key'); localStorage.removeItem('role'); localStorage.removeItem('login_key_id'); localStorage.removeItem('login_key_name'); localStorage.removeItem('login_key_hint'); window.location.href = '/'; }
          }
        }
      </script>`,
  });
}
