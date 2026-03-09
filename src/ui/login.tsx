// Login page — ACCESS_KEY input with sleek dark design
// Stores key in localStorage, no server-side session

import { html } from "hono/html";
import { Layout } from "./layout.tsx";

export function LoginPage() {
  return Layout({
    title: "Login",
    children: html`
      <div class="min-h-screen flex items-center justify-center p-4">
        <!-- Ambient glow background -->
        <div class="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-accent-cyan/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div class="w-full max-w-md" x-data="loginApp()">
          <!-- Logo & Title -->
          <div class="text-center mb-8 animate-in">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-700 glow-border mb-6">
              <svg class="w-8 h-8 text-accent-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h1 class="text-2xl font-semibold tracking-tight text-white">Copilot Gateway</h1>
            <p class="text-sm text-gray-500 mt-2 font-light">Enter your access key to continue</p>
          </div>

          <!-- Login Card -->
          <div class="glass-card p-8 glow-cyan animate-in delay-1">
            <div class="shimmer-line mb-8 rounded-full"></div>

            <form @submit.prevent="login()" class="space-y-5">
              <div>
                <label class="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-widest">Access Key</label>
                <input
                  type="password"
                  x-model="accessKey"
                  placeholder="Enter your access key..."
                  autofocus
                  required
                />
              </div>

              <button type="submit" class="btn-primary w-full" :disabled="loading">
                <span x-show="!loading">Authenticate</span>
                <span x-show="loading" class="flex items-center justify-center gap-2">
                  <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"/>
                  </svg>
                  Authenticating...
                </span>
              </button>
            </form>

            <div x-show="error" x-transition class="mt-4 p-3 rounded-lg bg-accent-rose/10 border border-accent-rose/20 text-accent-rose text-sm">
              <span x-text="error"></span>
            </div>
          </div>

          <!-- Footer -->
          <div class="text-center mt-6 animate-in delay-2">
            <p class="text-xs text-gray-600">
              Powered by GitHub Copilot API
            </p>
          </div>
        </div>
      </div>

      <script>
        function loginApp() {
          return {
            accessKey: '',
            loading: false,
            error: '',
            init() {
              // If already have a stored key, try to verify it
              const stored = localStorage.getItem('access_key');
              if (stored) {
                this.accessKey = stored;
                this.login();
              }
            },
            async login() {
              this.loading = true;
              this.error = '';
              try {
                const resp = await fetch('/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ access_key: this.accessKey }),
                });
                const data = await resp.json();
                if (data.ok) {
                  localStorage.setItem('access_key', this.accessKey);
                  localStorage.setItem('role', data.role || 'admin');
                  if (data.role === 'key') {
                    localStorage.setItem('login_key_id', data.keyId);
                    localStorage.setItem('login_key_name', data.keyName);
                    localStorage.setItem('login_key_hint', data.keyHint);
                  } else {
                    localStorage.removeItem('login_key_id');
                    localStorage.removeItem('login_key_name');
                    localStorage.removeItem('login_key_hint');
                  }
                  window.location.href = '/dashboard';
                } else {
                  localStorage.removeItem('access_key');
                  localStorage.removeItem('role');
                  this.error = data.error || 'Authentication failed';
                }
              } catch (e) {
                this.error = 'Connection error';
              } finally {
                this.loading = false;
              }
            }
          }
        }
      </script>`,
  });
}
