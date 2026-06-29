const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');
const MAX_RUNS_KEPT = 500; // trimmed lazily on append so the file doesn't grow unbounded

function appendRun(record) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  trimIfNeeded();
}

function trimIfNeeded() {
  let lines;
  try {
    lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  } catch {
    return;
  }
  if (lines.length > MAX_RUNS_KEPT) {
    fs.writeFileSync(LOG_FILE, lines.slice(-MAX_RUNS_KEPT).join('\n') + '\n');
  }
}

function readRuns(limit = 50) {
  let lines;
  try {
    lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return lines
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse(); // newest first
}

module.exports = { appendRun, readRuns };
