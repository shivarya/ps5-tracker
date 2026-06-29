require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readRuns } = require('./utils/runLog');

const PORT = process.env.DASHBOARD_PORT || 5055;
const API_URL = (process.env.API_URL || 'http://localhost:8000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY || '';

const api = axios.create({
  baseURL: API_URL,
  headers: API_KEY ? { 'X-Api-Key': API_KEY } : {},
  timeout: 15000,
});

const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'dashboard', 'index.html'));

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  if (req.url === '/api/runs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readRuns(50)));
    return;
  }

  if (req.url === '/api/status') {
    try {
      const { data } = await api.get('/status');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data?.data || []));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Could not reach ${API_URL}/status: ${err.message}` }));
    }
    return;
  }

  if (req.url === '/api/listings' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { data } = await api.post('/listings', body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      const status = err.response?.status || 502;
      const payload = err.response?.data || { error: `Could not reach ${API_URL}/listings: ${err.message}` };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[dashboard] serving at http://localhost:${PORT} (API_URL=${API_URL})`);
});
