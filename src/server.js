const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const GATEWAY_PORT = 18789;
const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const OPENCLAW_DIR = '/data/.openclaw';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// ============================================================
// 1. Start gateway as child process
// ============================================================

let gatewayProcess = null;
let gatewayReady = false;
let gatewayExitCode = null;

function startGateway() {
  console.log('[wrapper] Starting openclaw gateway...');
  gatewayProcess = spawn('openclaw', ['gateway', 'run'], {
    env: {
      ...process.env,
      OPENCLAW_HOME: '/data',
      OPENCLAW_CONFIG_PATH: `${OPENCLAW_DIR}/openclaw.json`,
      XDG_CONFIG_HOME: OPENCLAW_DIR,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  gatewayProcess.stdout.on('data', (d) => {
    const line = d.toString();
    process.stdout.write(`[gateway] ${line}`);
    if (line.includes('Gateway listening') || line.includes('ready')) {
      gatewayReady = true;
    }
  });

  gatewayProcess.stderr.on('data', (d) => {
    process.stderr.write(`[gateway] ${d}`);
  });

  gatewayProcess.on('exit', (code) => {
    console.log(`[wrapper] Gateway exited with code ${code}`);
    gatewayReady = false;
    gatewayExitCode = code;
    // Restart after a delay unless we're shutting down
    if (!shuttingDown) {
      setTimeout(() => startGateway(), 3000);
    }
  });
}

let shuttingDown = false;
process.on('SIGTERM', () => {
  shuttingDown = true;
  if (gatewayProcess) gatewayProcess.kill('SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  shuttingDown = true;
  if (gatewayProcess) gatewayProcess.kill('SIGINT');
  process.exit(0);
});

// ============================================================
// 2. Reverse proxy to gateway
// ============================================================

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_URL,
  ws: true,
  changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway unavailable', starting: !gatewayReady }));
  }
});

// ============================================================
// 3. Express app — setup UI + proxy
// ============================================================

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check for Railway
app.get('/health', (req, res) => {
  res.json({
    status: gatewayReady ? 'healthy' : 'starting',
    gateway: gatewayReady ? 'running' : (gatewayExitCode !== null ? `exited(${gatewayExitCode})` : 'starting'),
  });
});

// Setup page
app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// API: gateway status
app.get('/api/status', (req, res) => {
  const configExists = fs.existsSync(`${OPENCLAW_DIR}/openclaw.json`);
  res.json({
    gateway: gatewayReady ? 'running' : 'starting',
    configExists,
    channels: getChannelStatus(),
  });
});

// Helper: run openclaw CLI command
function clawCmd(cmd) {
  return new Promise((resolve) => {
    console.log(`[wrapper] Running: openclaw ${cmd}`);
    exec(`openclaw ${cmd}`, {
      env: {
        ...process.env,
        OPENCLAW_HOME: '/data',
        OPENCLAW_CONFIG_PATH: `${OPENCLAW_DIR}/openclaw.json`,
      },
      timeout: 15000,
    }, (err, stdout, stderr) => {
      const result = { ok: !err, stdout: stdout.trim(), stderr: stderr.trim(), code: err?.code };
      console.log(`[wrapper] Result: ok=${result.ok} stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`);
      resolve(result);
    });
  });
}

// API: gateway status via CLI
app.get('/api/gateway-status', async (req, res) => {
  const result = await clawCmd('status');
  res.json(result);
});

// Cache for pairing results (avoid spawning CLI every poll)
let pairingCache = { pending: [], ts: 0 };
const PAIRING_CACHE_TTL = 10000; // 10s

// API: list pending pairings via CLI
app.get('/api/pairings', async (req, res) => {
  if (Date.now() - pairingCache.ts < PAIRING_CACHE_TTL) {
    return res.json({ pending: pairingCache.pending });
  }

  const pending = [];
  const channels = ['telegram', 'discord'];

  for (const ch of channels) {
    // Check if channel is configured
    try {
      const config = JSON.parse(fs.readFileSync(`${OPENCLAW_DIR}/openclaw.json`, 'utf8'));
      if (!config.channels?.[ch]?.enabled) continue;
    } catch { continue; }

    const result = await clawCmd(`pairing list ${ch}`);
    if (result.ok && result.stdout) {
      const lines = result.stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const codeMatch = line.match(/([A-Z0-9]{8})/);
        if (codeMatch) {
          pending.push({
            id: codeMatch[1],
            code: codeMatch[1],
            channel: ch,
          });
        }
      }
    }
  }

  if (pending.length > 0) {
    console.log(`[wrapper] Found ${pending.length} pending pairing(s)`);
  }
  pairingCache = { pending, ts: Date.now() };
  res.json({ pending });
});

// API: approve pairing
app.post('/api/pairings/:id/approve', async (req, res) => {
  const channel = req.body.channel || 'telegram';
  const result = await clawCmd(`pairing approve ${channel} ${req.params.id}`);
  res.json(result);
});

// API: reject pairing
app.post('/api/pairings/:id/reject', async (req, res) => {
  const channel = req.body.channel || 'telegram';
  const result = await clawCmd(`pairing reject ${channel} ${req.params.id}`);
  res.json(result);
});

// ============================================================
// Google OAuth flow
// ============================================================

const GOG_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

// gog uses XDG_CONFIG_HOME/gogcli/ — we point XDG_CONFIG_HOME to OPENCLAW_DIR
// so gog config lives at /data/.openclaw/gogcli/ (persistent + gitignored)
const GOG_CONFIG_DIR = `${OPENCLAW_DIR}/gogcli`;
const GOG_CREDENTIALS_PATH = `${GOG_CONFIG_DIR}/credentials.json`;
const GOG_STATE_PATH = `${GOG_CONFIG_DIR}/state.json`;

// Helper: run gog CLI command (config stored on persistent volume)
function gogCmd(cmd) {
  return new Promise((resolve) => {
    console.log(`[wrapper] Running: gog ${cmd}`);
    exec(`gog ${cmd}`, {
      timeout: 15000,
      env: { ...process.env, XDG_CONFIG_HOME: `${OPENCLAW_DIR}` },
    }, (err, stdout, stderr) => {
      const result = { ok: !err, stdout: stdout.trim(), stderr: stderr.trim() };
      console.log(`[wrapper] gog result: ok=${result.ok} stdout=${result.stdout.slice(0, 200)}`);
      resolve(result);
    });
  });
}

// API: Google auth status
app.get('/api/google/status', async (req, res) => {
  const hasCredentials = fs.existsSync(GOG_CREDENTIALS_PATH);
  let authenticated = false;
  let email = '';

  if (hasCredentials) {
    const result = await gogCmd('auth list --plain');
    if (result.ok && result.stdout && !result.stdout.includes('no accounts')) {
      authenticated = true;
      email = result.stdout.split('\n')[0]?.split('\t')[0] || '';
    }

    // Also read saved email from state
    if (!email) {
      try {
        const state = JSON.parse(fs.readFileSync(GOG_STATE_PATH, 'utf8'));
        email = state.email || '';
      } catch {}
    }
  }

  res.json({ hasCredentials, authenticated, email });
});

// API: Save Google OAuth credentials
app.post('/api/google/credentials', async (req, res) => {
  const { clientId, clientSecret, email } = req.body;
  if (!clientId || !clientSecret || !email) {
    return res.json({ ok: false, error: 'Missing fields' });
  }

  try {
    // Write credentials.json in Google's format
    fs.mkdirSync(GOG_CONFIG_DIR, { recursive: true });

    const credentials = {
      web: {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: [`${getBaseUrl(req)}/auth/google/callback`],
      }
    };

    fs.writeFileSync(GOG_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));

    // Store credentials via gog CLI
    const result = await gogCmd(`auth credentials set ${GOG_CREDENTIALS_PATH}`);
    console.log(`[wrapper] gog credentials set: ${JSON.stringify(result)}`);

    // Save state
    fs.writeFileSync(GOG_STATE_PATH, JSON.stringify({ email, clientId }));

    res.json({ ok: true });
  } catch (err) {
    console.error('[wrapper] Failed to save Google credentials:', err);
    res.json({ ok: false, error: err.message });
  }
});

// OAuth: Start Google auth flow
app.get('/auth/google/start', (req, res) => {
  const email = req.query.email || '';

  try {
    // Read credentials to get client_id
    const creds = JSON.parse(fs.readFileSync(GOG_CREDENTIALS_PATH, 'utf8'));
    const clientId = creds.web?.client_id || creds.installed?.client_id;
    if (!clientId) throw new Error('No client_id found');

    const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;
    const state = Buffer.from(JSON.stringify({ email })).toString('base64url');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOG_SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);
    if (email) authUrl.searchParams.set('login_hint', email);

    res.redirect(authUrl.toString());
  } catch (err) {
    console.error('[wrapper] Failed to start Google auth:', err);
    res.redirect('/setup?google=error&message=' + encodeURIComponent(err.message));
  }
});

// OAuth: Google callback
app.get('/auth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect('/setup?google=error&message=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect('/setup?google=error&message=no_code');
  }

  try {
    // Decode state
    let email = '';
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      email = decoded.email || '';
    } catch {}

    // Read credentials
    const creds = JSON.parse(fs.readFileSync(GOG_CREDENTIALS_PATH, 'utf8'));
    const clientId = creds.web?.client_id || creds.installed?.client_id;
    const clientSecret = creds.web?.client_secret || creds.installed?.client_secret;
    const redirectUri = `${getBaseUrl(req)}/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    console.log(`[wrapper] Google token exchange: ${tokenRes.status} has_refresh=${!!tokens.refresh_token}`);

    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. Try revoking app access at myaccount.google.com/permissions and retry.');
    }

    // Get user email if not provided
    if (!email && tokens.access_token) {
      try {
        const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const info = await infoRes.json();
        email = info.email || email;
      } catch {}
    }

    // Write token file for gog import
    const tokenFile = `/tmp/gog-token-${Date.now()}.json`;
    fs.writeFileSync(tokenFile, JSON.stringify({
      email,
      refresh_token: tokens.refresh_token,
      client: 'default',
    }));

    // Import via gog CLI
    const result = await gogCmd(`auth tokens import ${tokenFile}`);
    console.log(`[wrapper] gog token import: ${JSON.stringify(result)}`);

    // Clean up
    try { fs.unlinkSync(tokenFile); } catch {}

    // Also try gog auth add with the manual flow approach, passing the token directly
    if (!result.ok) {
      // Fallback: write token to gog's keyring directly
      console.log('[wrapper] CLI import failed, trying manual token storage...');
      // Store as env var for gog to pick up
      const gogDir = '/root/.config/gogcli';
      fs.mkdirSync(gogDir, { recursive: true });
      fs.writeFileSync(`${gogDir}/token-${email}.json`, JSON.stringify({
        refresh_token: tokens.refresh_token,
        token_type: 'Bearer',
        expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      }));
    }

    // Update state
    fs.writeFileSync(GOG_STATE_PATH, JSON.stringify({ email, authenticated: true }));

    res.redirect('/setup?google=success');
  } catch (err) {
    console.error('[wrapper] Google OAuth callback error:', err);
    res.redirect('/setup?google=error&message=' + encodeURIComponent(err.message));
  }
});

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getChannelStatus() {
  try {
    const config = JSON.parse(fs.readFileSync(`${OPENCLAW_DIR}/openclaw.json`, 'utf8'));
    const channels = {};
    if (config.channels?.telegram?.enabled) channels.telegram = 'configured';
    if (config.channels?.discord?.enabled) channels.discord = 'configured';
    return channels;
  } catch {
    return {};
  }
}

// Everything else → proxy to gateway
app.all('/webhook/*', (req, res) => proxy.web(req, res));

// Proxy non-setup API routes to gateway
const SETUP_API_PREFIXES = ['/api/status', '/api/pairings', '/api/google', '/api/gateway'];
app.all('/api/*', (req, res) => {
  if (SETUP_API_PREFIXES.some(p => req.path.startsWith(p))) return;
  proxy.web(req, res);
});

// ============================================================
// 4. Start server
// ============================================================

const server = http.createServer(app);

// WebSocket upgrade → proxy to gateway
server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[wrapper] Express listening on :${PORT}`);
  startGateway();
});
