/**
 * OAuth 2.1 + PKCE against Swiggy's official Builders MCP platform (https://mcp.swiggy.com/builders/).
 * Used by checkers/instamart.js instead of browser automation — Instamart blocks even a real headed
 * Playwright browser (see instamart.js docblock), but this is a sanctioned API.
 *
 * Per Swiggy's docs (2026-06-30): no refresh-token grant in v1.0 — the access token lasts 5 days, then
 * a full interactive re-login (phone + OTP, completed by a human in a real browser) is required. This
 * cannot be automated; `npm run swiggy-login` must be re-run manually every ~5 days. getValidToken()
 * throws a clear, actionable error rather than attempting anything silent when the token is missing/expired.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');
const axios = require('axios');

const BASE_URL = 'https://mcp.swiggy.com';
const TOKEN_FILE = path.join(__dirname, '..', '.swiggy_token.json');
const CALLBACK_PORT = 51823;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

function loadStoredAuth() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveStoredAuth(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

/**
 * Returns a valid access token, or throws with instructions if none exists / it has expired.
 * Never attempts silent re-auth — the OTP step requires a human in a real browser.
 */
function getValidAccessToken() {
  const stored = loadStoredAuth();
  if (!stored || !stored.access_token) {
    throw new Error('No Swiggy MCP login found. Run "npm run swiggy-login" in local-crawler/ once.');
  }
  if (Date.now() >= stored.expires_at - 60000) {
    throw new Error(
      `Swiggy MCP access token expired (or expiring within 60s) at ${new Date(stored.expires_at).toISOString()}. ` +
      'Run "npm run swiggy-login" again — Swiggy MCP v1.0 has no refresh-token grant, so this needs a fresh interactive login every ~5 days.'
    );
  }
  return stored.access_token;
}

async function registerClient() {
  const { data } = await axios.post(`${BASE_URL}/auth/register`, {
    client_name: 'ps5-tracker-local-crawler',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
  return data.client_id;
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (error || !code || state !== expectedState) {
        res.end(`<h2>Swiggy login failed</h2><p>${error || 'Invalid state/code'}. You can close this tab and check the terminal.</p>`);
        server.close();
        reject(new Error(`OAuth callback error: ${error || 'state mismatch or missing code'}`));
        return;
      }
      res.end('<h2>Swiggy login successful</h2><p>You can close this tab and return to the terminal.</p>');
      server.close();
      resolve(code);
    });
    server.listen(CALLBACK_PORT);
  });
}

function openBrowser(url) {
  exec(`start "" "${url}"`);
}

/**
 * Runs the full interactive OAuth flow: registers a client, opens a browser for the user to complete
 * phone + OTP login, catches the redirect, exchanges the code for an access token, and persists it.
 * Must be run manually (`npm run swiggy-login`) — not callable from the unattended scheduled crawler.
 */
async function login() {
  console.log('[swiggy-auth] registering OAuth client...');
  const clientId = await registerClient();

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authorizeUrl = `${BASE_URL}/auth/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    scope: 'mcp:tools mcp:resources mcp:prompts',
  }).toString();

  console.log('[swiggy-auth] opening browser for phone + OTP login...');
  console.log(`[swiggy-auth] if it doesn't open automatically, visit:\n${authorizeUrl}`);
  openBrowser(authorizeUrl);

  console.log('[swiggy-auth] waiting for you to complete login in the browser...');
  const code = await waitForCallback(state);

  console.log('[swiggy-auth] exchanging code for access token...');
  const { data } = await axios.post(`${BASE_URL}/auth/token`, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
  });

  saveStoredAuth({
    client_id: clientId,
    access_token: data.access_token,
    token_type: data.token_type,
    scope: data.scope,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  console.log(`[swiggy-auth] login successful — token valid until ${new Date(Date.now() + data.expires_in * 1000).toISOString()}`);
}

module.exports = { getValidAccessToken, login, BASE_URL };
