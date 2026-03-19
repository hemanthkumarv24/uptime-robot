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

### Quick start

```bash
git clone https://github.com/<you>/uptime-robot.git
cd uptime-robot
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

### What you get

- **Monitors keep running** on the server even after you close the browser tab
- **Multiple monitors** — track as many URLs as you need simultaneously
- **Persistent across restarts** — monitors are saved to `monitors.json` and automatically resume on server restart
- **Real-time logs** streamed to the browser via Server-Sent Events
- **REST API** — manage monitors programmatically:

  | Method | Path | Description |
  |--------|------|-------------|
  | `GET` | `/api/monitors` | List all monitors |
  | `POST` | `/api/monitors` | Add and start a monitor `{ url, interval }` |
  | `GET` | `/api/monitors/:id` | Get a single monitor |
  | `DELETE` | `/api/monitors/:id` | Remove a monitor |
  | `POST` | `/api/monitors/:id/start` | Resume a stopped monitor |
  | `POST` | `/api/monitors/:id/stop` | Pause a running monitor |
  | `GET` | `/api/monitors/:id/logs` | Get ping logs for a monitor |
  | `POST` | `/api/ping` | One-off ping `{ url }` |
  | `GET` | `/api/events` | SSE stream for real-time updates |

### Running on a VPS / always-on machine

```bash
# With pm2 (keeps the server alive after logout)
npm install -g pm2
pm2 start server.js --name uptime-robot
pm2 save
pm2 startup
```

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
- **Browser Mode**: lightweight, no install required
- Auto-detects mode — one `index.html` works in both
- Multiple URL monitors with individual start/stop/delete controls
- Live countdown to next ping
- Colour-coded ping log (✅ success / ❌ error)
- Ping intervals: 1, 2, 3, 5, 10, 15, 30, or 60 minutes
- Real-time log streaming via SSE (server mode)

## How it works

**Server mode:** The Node.js server uses Node's built-in `http`/`https` modules to ping target URLs from the server side (no CORS issues). Schedules are managed with `setInterval`. Monitors and their `autoStart` flag are persisted to `monitors.json` so they survive restarts.

**Browser mode:** Uses `fetch` with `mode: 'no-cors'` to reach cross-origin endpoints without needing CORS headers on the target. The ping is a simple GET request — just enough to wake a sleeping container.