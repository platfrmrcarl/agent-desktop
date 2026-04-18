export function renderLoginPage(options: { error?: string; retryAfter?: number }): string {
  const errorBlock = options.error
    ? `<div class="error">${escapeHtml(options.error)}${options.retryAfter ? ` (retry in ${options.retryAfter}s)` : ''}</div>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent — Login</title>
<style>
:root { color-scheme: light dark; }
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0b0b0b; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #151515; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); width: 320px; max-width: 90vw; }
h1 { margin: 0 0 1rem; font-size: 1.1rem; font-weight: 600; }
label { display: block; font-size: 0.85rem; margin: 0.5rem 0 0.25rem; }
input[type=password] { width: 100%; padding: 0.55rem; background: #0b0b0b; color: #eee; border: 1px solid #333; border-radius: 4px; font-size: 1rem; box-sizing: border-box; }
input[type=password]:focus { outline: none; border-color: #4a9eff; }
.remember { margin: 0.75rem 0; font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem; }
button { width: 100%; padding: 0.6rem; background: #4a9eff; color: white; border: 0; border-radius: 4px; font-size: 1rem; cursor: pointer; margin-top: 0.5rem; }
button:hover { background: #357ad3; }
.error { background: #3a1a1a; border: 1px solid #7a2a2a; color: #ff9b9b; padding: 0.5rem; border-radius: 4px; font-size: 0.85rem; margin-bottom: 0.75rem; }
</style>
</head>
<body>
<form class="card" method="POST" action="/login" autocomplete="on">
  <h1>Agent — sign in</h1>
  ${errorBlock}
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autofocus required autocomplete="current-password">
  <label class="remember"><input type="checkbox" name="remember" value="1"> Remember me for 30 days</label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
