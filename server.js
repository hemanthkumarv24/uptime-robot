'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');

const app  = express();
const PORT = process.env.PORT || 3000;

// Optional API secret — set API_SECRET env var to protect all /api/* routes
const API_SECRET = process.env.API_SECRET || null;

// Self-keep-alive URL — set APP_URL (or Render sets RENDER_EXTERNAL_URL automatically)
const SELF_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

// Where monitor configs are saved so they survive server restarts
const DATA_FILE = path.join(__dirname, 'monitors.json');

// Read index.html once at startup and serve from memory to avoid per-request FS access
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

app.use(express.json());

// ── Public routes (no auth required) ─────────────────────────────────────────

// Serve only the frontend HTML — never expose server.js, monitors.json, etc.
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(indexHtml);
});

// Health check — always public; used by keep-alive pings and mode detection.
// Returns authRequired so the UI knows whether to prompt for an API key.
app.get('/health', (_req, res) => {
  res.json({ ok: true, authRequired: !!API_SECRET });
});

// ── Auth middleware (applied to all /api/* routes) ────────────────────────────

function requireAuth(req, res, next) {
  if (!API_SECRET) return next(); // no secret configured → open access
  const auth     = req.headers.authorization || '';
  // For EventSource (SSE) clients that cannot set headers, also accept ?token=
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  // timingSafeEqual requires equal-length buffers; short-circuit on length mismatch
  const providedBuf = Buffer.from(provided);
  const secretBuf   = Buffer.from(API_SECRET);
  const valid = providedBuf.length === secretBuf.length &&
                crypto.timingSafeEqual(providedBuf, secretBuf);
  if (!valid) return res.status(401).json({ error: 'Unauthorized — check your API_SECRET' });
  next();
}

app.use('/api', requireAuth);

const monitors   = new Map(); // id → monitor object
const logs       = new Map(); // id → array of log entries (newest first)
const timers     = new Map(); // id → setInterval handle
const sseClients = new Set(); // active SSE response objects

// ── Persistence ───────────────────────────────────────────────────────────────

function saveMonitors() {
  const data = Array.from(monitors.values()).map(({ id, url, interval, createdAt, lastStatus, lastChecked, autoStart }) => ({
    id, url, interval, createdAt, lastStatus, lastChecked, autoStart,
  }));
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save monitors.json:', err.message);
  }
}

function loadMonitors() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const m of data) {
      monitors.set(m.id, { ...m, running: false });
      logs.set(m.id, []);
      if (m.autoStart) startMonitor(m.id);
    }
    console.log(`Loaded ${monitors.size} monitor(s) from disk.`);
  } catch (err) {
    console.error('Failed to load monitors.json:', err.message);
  }
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

// ── Ping ──────────────────────────────────────────────────────────────────────

function pingUrl(rawUrl, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (_) {
      return resolve({ success: false, error: 'Invalid URL', duration: 0 });
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'GET',
      timeout:  timeoutMs,
      headers:  { 'User-Agent': 'Uptime-Monitor-selfhosted/1.0' },
    };

    const req = lib.request(options, (res) => {
      res.resume(); // drain to free socket
      resolve({ success: true, statusCode: res.statusCode, duration: Date.now() - start });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out', duration: Date.now() - start });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message, duration: Date.now() - start });
    });

    req.end();
  });
}

// ── Log helpers ───────────────────────────────────────────────────────────────

function addLog(monitorId, type, message, duration) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    duration,
  };
  const list = logs.get(monitorId) || [];
  list.unshift(entry);
  if (list.length > 500) list.pop();
  logs.set(monitorId, list);
  broadcast({ event: 'log', monitorId, entry });
}

// ── Monitor lifecycle ─────────────────────────────────────────────────────────

async function doPing(id) {
  const monitor = monitors.get(id);
  if (!monitor) return;

  // Set nextPingAt at the START so it reflects the interval from when the ping began,
  // not from when it completed (avoids drift caused by slow responses / timeouts).
  monitor.nextPingAt = Date.now() + monitor.interval * 60 * 1000;

  const result = await pingUrl(monitor.url);
  monitor.lastChecked = new Date().toISOString();

  if (result.success) {
    monitor.lastStatus = 'up';
    addLog(id, 'success', `✅ Online (HTTP ${result.statusCode}) — ${result.duration} ms`, result.duration);
  } else {
    monitor.lastStatus = 'down';
    addLog(id, 'error', `❌ Unreachable — ${result.error} (${result.duration} ms)`, result.duration);
  }

  monitor.autoStart = true; // persist running state
  saveMonitors();
  broadcast({ event: 'status', monitor: publicMonitor(monitor) });
}

function startMonitor(id) {
  if (timers.has(id)) return; // already running
  const monitor = monitors.get(id);
  if (!monitor) return;

  monitor.running    = true;
  monitor.nextPingAt = Date.now() + monitor.interval * 60 * 1000;

  // Ping immediately, then on schedule
  doPing(id);
  timers.set(id, setInterval(() => doPing(id), monitor.interval * 60 * 1000));

  addLog(id, 'info', `🚀 Monitoring started — interval: ${monitor.interval} min`, 0);
  broadcast({ event: 'status', monitor: publicMonitor(monitor) });
  saveMonitors();
}

function stopMonitor(id) {
  const timer = timers.get(id);
  if (timer) { clearInterval(timer); timers.delete(id); }

  const monitor = monitors.get(id);
  if (!monitor) return;

  monitor.running   = false;
  monitor.autoStart = false;
  delete monitor.nextPingAt;

  addLog(id, 'info', '⏹ Monitoring stopped', 0);
  broadcast({ event: 'status', monitor: publicMonitor(monitor) });
  saveMonitors();
}

function publicMonitor(m) {
  return {
    id:          m.id,
    url:         m.url,
    interval:    m.interval,
    running:     timers.has(m.id),
    lastStatus:  m.lastStatus  || 'unknown',
    lastChecked: m.lastChecked || null,
    nextPingAt:  m.nextPingAt  || null,
    createdAt:   m.createdAt,
  };
}

// ── REST API ──────────────────────────────────────────────────────────────────

// List all monitors
app.get('/api/monitors', (_req, res) => {
  res.json(Array.from(monitors.values()).map(publicMonitor));
});

// Add + immediately start a new monitor
app.post('/api/monitors', (req, res) => {
  const { url, interval = 5 } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }

  const cleanUrl = url.trim();

  // Reject obviously invalid URLs early
  try { new URL(cleanUrl); } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Prevent duplicates
  for (const m of monitors.values()) {
    if (m.url === cleanUrl) {
      return res.status(409).json({ error: 'A monitor for this URL already exists', id: m.id });
    }
  }

  const parsedInterval = Math.max(1, Math.min(60, parseInt(interval, 10) || 5));
  const id = crypto.randomUUID();

  monitors.set(id, {
    id,
    url:        cleanUrl,
    interval:   parsedInterval,
    running:    false,
    lastStatus: 'unknown',
    createdAt:  new Date().toISOString(),
  });
  logs.set(id, []);

  startMonitor(id);
  res.status(201).json(publicMonitor(monitors.get(id)));
});

// Get single monitor
app.get('/api/monitors/:id', (req, res) => {
  const m = monitors.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Monitor not found' });
  res.json(publicMonitor(m));
});

// Delete a monitor
app.delete('/api/monitors/:id', (req, res) => {
  const { id } = req.params;
  if (!monitors.has(id)) return res.status(404).json({ error: 'Monitor not found' });
  stopMonitor(id);
  monitors.delete(id);
  logs.delete(id);
  saveMonitors();
  broadcast({ event: 'deleted', monitorId: id });
  res.json({ success: true });
});

// Start a stopped monitor
app.post('/api/monitors/:id/start', (req, res) => {
  const { id } = req.params;
  if (!monitors.has(id)) return res.status(404).json({ error: 'Monitor not found' });
  startMonitor(id);
  res.json(publicMonitor(monitors.get(id)));
});

// Stop a running monitor
app.post('/api/monitors/:id/stop', (req, res) => {
  const { id } = req.params;
  if (!monitors.has(id)) return res.status(404).json({ error: 'Monitor not found' });
  stopMonitor(id);
  res.json(publicMonitor(monitors.get(id)));
});

// Get logs for a monitor
app.get('/api/monitors/:id/logs', (req, res) => {
  const { id } = req.params;
  if (!monitors.has(id)) return res.status(404).json({ error: 'Monitor not found' });
  res.json(logs.get(id) || []);
});

// Immediate one-off ping (does not affect scheduled monitors)
app.post('/api/ping', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  try { new URL(url.trim()); } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  const result = await pingUrl(url.trim());
  res.json(result);
});

// SSE — real-time event stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send a heartbeat comment every 20 s to keep the connection alive through proxies
  const hb = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      console.error('SSE heartbeat write error — removing client:', err.message);
      clearInterval(hb);
      sseClients.delete(res);
    }
  }, 20000);

  sseClients.add(res);

  // Send current snapshot so the client can build its initial UI
  try {
    res.write(`data: ${JSON.stringify({ event: 'snapshot', monitors: Array.from(monitors.values()).map(publicMonitor) })}\n\n`);
  } catch (_) {}

  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

loadMonitors();

// ── Self-keep-alive ───────────────────────────────────────────────────────────
// On free-tier hosts (e.g. Render) the process sleeps after ~15 min of
// inactivity, which would stop all setInterval monitors.  Pinging our own
// /health endpoint every 14 minutes prevents the host from putting us to sleep.
//
// Set APP_URL (or Render auto-sets RENDER_EXTERNAL_URL) to enable this.

if (SELF_URL) {
  const KEEPALIVE_MS = 14 * 60 * 1000; // 14 minutes — safely under Render's 15-min threshold
  setInterval(() => {
    pingUrl(`${SELF_URL}/health`, 15000)
      .then(r => {
        if (r.success) {
          console.log(`[keep-alive] ✅ Self-ping OK — ${r.duration} ms`);
        } else {
          console.warn(`[keep-alive] ⚠️  Self-ping failed: ${r.error}`);
        }
      })
      .catch(err => console.warn('[keep-alive] ⚠️ ', err.message));
  }, KEEPALIVE_MS);
  console.log(`  Keep-alive: self-pinging ${SELF_URL}/health every 14 min`);
} else {
  console.log('  Keep-alive: set APP_URL env var to prevent sleeping on free-tier hosts');
}

app.listen(PORT, () => {
  console.log('');
  console.log('  ⏱  Uptime Robot server started');
  console.log(`  → http://localhost:${PORT}`);
  if (API_SECRET) console.log('  🔒 API authentication: enabled (API_SECRET is set)');
  else            console.log('  🔓 API authentication: disabled (set API_SECRET to enable)');
  console.log('');
  console.log('  Monitors keep running even when the browser is closed.');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
