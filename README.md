# Uptime Robot

A lightweight uptime monitor that pings your API URLs on a schedule to keep free-tier deployments (Render, Railway, Fly.io, etc.) from sleeping.

**Two modes — choose what works for you:**

| Mode | How to use | Keeps running when browser closes? |
|------|-----------|-----------------------------------|
| **Server Mode** *(recommended)* | `npm start` on your machine or a VPS | ✅ Yes — 24/7 |
| **Browser Mode** | Open the GitHub Pages URL | ❌ No — tab must stay open |

---

## Server Mode (runs 24/7)

Run the included Node.js server so monitoring continues even after you close your browser.

### Quick start (local / VPS)

```bash
git clone https://github.com/<you>/uptime-robot.git
cd uptime-robot
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

### Deploying on Render (free tier) — stays awake

> **Problem:** Render free-tier services sleep after 15 minutes of inactivity, which would stop all monitors.
>
> **Solution:** Two complementary keep-alive mechanisms ensure the server stays awake:
> 1. **Self-ping** — the server pings its own `/health` endpoint every 14 minutes (always active when `APP_URL` is set).
> 2. **GitHub Actions cron** — an external workflow pings the server every 10 minutes as a backup (see below).

**Steps:**

1. Push your code to GitHub.
2. Create a new **Web Service** on [render.com](https://render.com) from your repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. In the Render dashboard, go to **Environment → Environment Variables** and add:

   | Variable | Value | Description |
   |----------|-------|-------------|
   | `APP_URL` | `https://your-service.onrender.com` | Enables the self-ping keep-alive |
   | `API_SECRET` | a strong random string | Protects your API from unauthorised access |

   > Render also sets `RENDER_EXTERNAL_URL` automatically, so `APP_URL` is optional if you are on Render.

4. Set up the **GitHub Actions keep-alive** (see below).

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (default `3000`) | Port the server listens on |
| `APP_URL` | Recommended | Your public server URL (e.g. `https://my-uptime-robot.onrender.com`). Enables self-ping every 14 min. Render sets `RENDER_EXTERNAL_URL` automatically as a fallback. |
| `API_SECRET` | Recommended | A secret string. When set, all `/api/*` requests must include `Authorization: Bearer <secret>`. The UI will prompt for it automatically. |

### API authentication

Set `API_SECRET` to a strong random string to protect your monitors from unauthorised access.

```bash
# Generate a random secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

When `API_SECRET` is set:
- All `/api/*` endpoints require `Authorization: Bearer <secret>`
- The UI automatically prompts for the key on first visit and stores it in `sessionStorage`
- The `/health` endpoint remains public (used by keep-alive pings)
- SSE connections pass the token as `?token=<secret>` (EventSource cannot set headers)

### GitHub Actions keep-alive (external backup pinger)

Even with the server's self-ping, it's worth having an *external* pinger that can wake the server if it somehow goes to sleep.

**One-time setup:**

1. Go to your repo → **Settings → Secrets and variables → Actions → Variables**
2. Click **New repository variable**, name it `APP_URL`, and set it to your public server URL (e.g. `https://my-uptime-robot.onrender.com`)
3. The `keepalive.yml` workflow will now ping `/health` every 10 minutes automatically.

> The workflow is skipped gracefully when `APP_URL` is not configured, so it won't cause errors on forks or local-only setups.

### Running with PM2 (VPS / always-on machine)

```bash
npm install -g pm2
pm2 start server.js --name uptime-robot
pm2 save
pm2 startup
```

### What you get

- **Monitors keep running** on the server even after you close the browser tab
- **Multiple monitors** — track as many URLs as you need simultaneously
- **Persistent across restarts** — monitors are saved to `monitors.json` and automatically resume on server restart
- **Real-time logs** streamed to the browser via Server-Sent Events
- **Self-keep-alive** — the server pings itself every 14 min to stay awake on free-tier hosts
- **External keep-alive** — GitHub Actions pings the server every 10 min as a backup
- **Optional API authentication** — protect your monitors with a secret key
- **REST API** — manage monitors programmatically:

  | Method | Path | Auth? | Description |
  |--------|------|-------|-------------|
  | `GET` | `/health` | ❌ Public | Health check; returns `{ ok, authRequired }` |
  | `GET` | `/api/monitors` | ✅ | List all monitors |
  | `POST` | `/api/monitors` | ✅ | Add and start a monitor `{ url, interval }` |
  | `GET` | `/api/monitors/:id` | ✅ | Get a single monitor |
  | `DELETE` | `/api/monitors/:id` | ✅ | Remove a monitor |
  | `POST` | `/api/monitors/:id/start` | ✅ | Resume a stopped monitor |
  | `POST` | `/api/monitors/:id/stop` | ✅ | Pause a running monitor |
  | `GET` | `/api/monitors/:id/logs` | ✅ | Get ping logs for a monitor |
  | `POST` | `/api/ping` | ✅ | One-off ping `{ url }` |
  | `GET` | `/api/events` | ✅ | SSE stream for real-time updates |

---

## Browser Mode (static / GitHub Pages)

If you just want the simple browser-based pinger, open the GitHub Pages URL. The page auto-detects that no server is present and falls back to browser mode, showing a warning that monitoring stops when the tab is closed.

### Deploying to GitHub Pages

The repository includes a GitHub Actions workflow that automatically deploys to GitHub Pages on every push to `main`.

**One-time setup:**

1. Go to **Settings → Pages** in your GitHub repository
2. Under *Source*, select **GitHub Actions**
3. Push your changes to `main` — the workflow deploys automatically

---

## Features

- **Server Mode**: 24/7 monitoring — survives browser close and server restart
- **Self-keep-alive**: server pings itself every 14 min; GitHub Actions pings every 10 min as backup
- **API authentication**: optional `API_SECRET` protects all API endpoints
- **Browser Mode**: lightweight, no install required
- Auto-detects mode — one `index.html` works in both
- Multiple URL monitors with individual start/stop/delete controls
- Live countdown to next ping
- Colour-coded ping log (✅ success / ❌ error)
- Ping intervals: 1, 2, 3, 5, 10, 15, 30, or 60 minutes
- Real-time log streaming via SSE (server mode)

## How it works

**Server mode:** The Node.js server uses Node's built-in `http`/`https` modules to ping target URLs from the server side (no CORS issues). Schedules are managed with `setInterval`. Monitors and their `autoStart` flag are persisted to `monitors.json` so they survive restarts.

**Self-keep-alive:** If `APP_URL` or `RENDER_EXTERNAL_URL` is set, the server pings its own `/health` endpoint every 14 minutes. Since Render free-tier sleeps after 15 minutes of inactivity, this keeps `setInterval` running continuously.

**External keep-alive:** The `.github/workflows/keepalive.yml` workflow runs on GitHub's infrastructure (free) every 10 minutes and hits `APP_URL/health`. This provides an external backup: if the server somehow falls asleep (e.g., during a restart), this request will wake it up again.

**Browser mode:** Uses `fetch` with `mode: 'no-cors'` to reach cross-origin endpoints without needing CORS headers on the target. The ping is a simple GET request — just enough to wake a sleeping container.
