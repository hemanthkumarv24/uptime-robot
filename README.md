# Uptime Robot

A lightweight static webpage that periodically pings any API URL from your browser to keep free-tier deployments (Render, Railway, Fly.io, etc.) from sleeping.

## Features

- Enter any API URL you want to keep alive
- Choose a ping interval: **1, 2, 3, 5, 10, 15, 30, or 60 minutes**
- Live countdown timer to the next ping
- Colour-coded ping log (success / error)
- "Ping Now" button for an immediate manual ping
- API URL is saved in `localStorage` so it persists across refreshes
- Runs entirely in your browser — no server or backend needed

## Usage

1. Open the GitHub Pages URL (e.g. `https://<username>.github.io/uptime-robot/`)
2. Paste your API URL into the **API URL** field
3. Select the desired **Ping Interval**
4. Click **Start** — the page will ping the URL on that schedule
5. Keep the browser tab open while you need the pinging to run

## Deploying to GitHub Pages

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys the site to GitHub Pages whenever you push to the `main` branch.

**One-time setup:**

1. Go to **Settings → Pages** in your GitHub repository
2. Under *Source*, select **GitHub Actions**
3. Push your changes to `main` — the workflow will deploy automatically

## How it works

The page uses the browser `fetch` API with `mode: 'no-cors'` so it can reach cross-origin endpoints without needing CORS headers on the target server. The ping is a simple `GET` request — just enough to wake a sleeping dyno or container.

> **Note:** Keep the browser tab open. Once you close the tab the pinging stops.