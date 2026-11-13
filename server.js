// IG Auto-Reply — comment keyword -> DM (private reply)
// ============================================================
// Official Instagram Graph API ONLY. No password, no scraping,
// no headless browser. Safe by design: it uses the same API
// ManyChat/Chatfuel use (private replies to comments).
//
// How it works:
//   1. Someone comments a keyword (VIBE, REPLICA, FREE...) on your reel.
//   2. Meta sends your server a webhook (or the poller finds it).
//   3. The server waits ~12s, then sends ONE private reply DM with
//      your link/document, plus an optional public "Check DM" reply.
//   4. Meta's rules are enforced in code: 7-day window, 1 DM per
//      comment, 1 automated DM per user per 24h, dedupe across restarts.
//
// Zero dependencies — pure Node.js stdlib (Node 18+).
// Run:  node server.js     (see .env.example and SETUP.md)

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ---------- config ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'ig-auto-reply-verify';
const APP_SECRET = process.env.APP_SECRET || '';
const DRY_RUN = process.env.DRY_RUN === '1';
const REPLY_DELAY_MS = parseInt(process.env.REPLY_DELAY_MS || '12000', 10);
const POLL_MEDIA_IDS = (process.env.POLL_MEDIA_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const POLL_INTERVAL_MIN = parseInt(process.env.POLL_INTERVAL_MIN || '5', 10);

// Meta limits (enforced in code, not just documented)
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000; // 7 days
const PER_USER_DM_WINDOW_MS = 24 * 3600 * 1000; // 1 auto DM / user / 24h

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, DRY_RUN ? 'seen-dryrun.json' : 'seen.json');
const KEYWORDS_FILE = path.join(__dirname, 'keywords.json');

// ---------- helpers ----------
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function loadKeywords() {
  try {
    const raw = fs.readFileSync(KEYWORDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const flows = (parsed.flows || []).filter((f) => f.enabled !== false);
    log(`Loaded ${flows.length} keyword flow(s) from keywords.json`);
    return flows;
  } catch (e) {
    log('ERROR: cannot read keywords.json:', e.message);
    return [];
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { comments: {}, users: {} }; // comments: {id: ts}, users: {userId: lastDmTs}
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let keywords = loadKeywords();
let state = loadState();
const inFlight = new Set(); // comment ids already scheduled in this run

// ---------- keyword matching ----------
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function findFlow(text, mediaId) {
  const clean = normalize(text);
  for (const flow of keywords) {
    if (flow.mediaIds && !flow.mediaIds.includes('all') && mediaId && !flow.mediaIds.includes(mediaId)) {
      continue; // this flow is restricted to other posts
    }
    const kw = normalize(flow.keyword);
    if (!kw) continue;
    if (flow.match === 'exact') {
      if (clean === kw) return flow;
    } else {
      // default: contains — "vibe", "VIBE!!", "bghit vibe" all match
      if (clean.includes(kw)) return flow;
    }
  }
  return null;
}

// ---------- Graph API ----------
async function graphPost(endpointPath, params) {
  const body = new URLSearchParams({ ...params, access_token: PAGE_ACCESS_TOKEN });
  if (DRY_RUN) {
    log('[DRY RUN] would POST', endpointPath, '->', JSON.stringify(Object.fromEntries(body.entries())));
    return { id: 'dry-run' };
  }
  const res = await fetch(`${GRAPH_BASE}${endpointPath}`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API ${endpointPath} failed: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function sendPrivateReply(commentId, message) {
  // POST /{comment-id}/private_replies — the ONLY compliant way to DM a commenter.
  return graphPost(`/${commentId}/private_replies`, { message });
}

async function sendPublicReply(commentId, message) {
  // POST /{comment-id}/replies — public nested reply under the comment.
  return graphPost(`/${commentId}/replies`, { message });
}

// ---------- comment pipeline ----------
function queueComment(comment) {
  const { id, text, mediaId, fromId, username } = comment;
  if (!id || !text) return;
  if (state.comments[id] || inFlight.has(id)) {
    log(`Skip ${id} (@${username}): already handled`);
    return;
  }
  const flow = findFlow(text, mediaId);
  if (!flow) return; // not a keyword comment — ignore silently

  const ageMs = Date.now() - (comment.timestampMs || Date.now());
  if (ageMs > PRIVATE_REPLY_WINDOW_MS) {
    log(`Skip ${id} (@${username}): comment older than 7 days, Meta would reject it (error 551)`);
    state.comments[id] = Date.now();
    saveState();
    return;
  }
  if (fromId && state.users[fromId] && Date.now() - state.users[fromId] < PER_USER_DM_WINDOW_MS) {
    log(`Skip ${id} (@${username}): user already got an auto DM in the last 24h`);
    state.comments[id] = Date.now();
    saveState();
    return;
  }

  inFlight.add(id);
  log(`Queued "${flow.keyword}" from @${username} on ${mediaId || 'unknown media'} — reply in ${REPLY_DELAY_MS / 1000}s`);
  setTimeout(async () => {
    try {
      if (flow.publicReply) {
        await sendPublicReply(id, flow.publicReply);
        log(`Public reply sent on ${id}`);
      }
      await sendPrivateReply(id, flow.dmMessage);
      log(`DM sent to @${username} for keyword "${flow.keyword}"`);
      state.comments[id] = Date.now();
      if (fromId) state.users[fromId] = Date.now();
      saveState();
    } catch (e) {
      log(`ERROR replying to ${id}:`, e.message);
      // do NOT mark as seen — a retry (webhook redelivery / next poll) can pick it up
    } finally {
      inFlight.delete(id);
    }
  }, REPLY_DELAY_MS);
}

// ---------- webhook ----------
function verifySignature(rawBody, signature) {
  if (!APP_SECRET) return true; // no secret configured — accept (dev only)
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function handleWebhookBody(body) {
  if (body.object !== 'instagram') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const v = change.value || {};
      queueComment({
        id: v.id,
        text: v.text,
        mediaId: v.media && v.media.id,
        fromId: v.from && v.from.id,
        username: v.from && v.from.username,
        timestampMs: v.timestamp ? new Date(v.timestamp).getTime() : Date.now(),
      });
    }
  }
}

// ---------- poller (fallback if webhooks are not available) ----------
// Instagram has a `comments` webhook, but it needs Advanced Access.
// Polling GET /{media-id}/comments works with basic access and is the
// safety net: same pipeline, same dedupe, same limits.
async function pollOnce() {
  if (!PAGE_ACCESS_TOKEN) {
    log('Poller skipped: PAGE_ACCESS_TOKEN not set');
    return;
  }
  for (const mediaId of POLL_MEDIA_IDS) {
    try {
      const url = `${GRAPH_BASE}/${mediaId}/comments?fields=id,text,timestamp,from&limit=50&access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        log(`Poll ${mediaId} failed:`, JSON.stringify(data.error || data));
        continue;
      }
      for (const c of data.data || []) {
        queueComment({
          id: c.id,
          text: c.text,
          mediaId,
          fromId: c.from && c.from.id,
          username: c.from && c.from.username,
          timestampMs: c.timestamp ? new Date(c.timestamp).getTime() : Date.now(),
        });
      }
    } catch (e) {
      log(`Poll ${mediaId} error:`, e.message);
    }
  }
}

// ---------- HTTP server ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/webhook') {
    // Meta verification handshake
    if (url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(url.searchParams.get('hub.challenge') || '');
      log('Webhook verified by Meta');
    } else {
      res.writeHead(403).end('Forbidden');
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      dryRun: DRY_RUN,
      flows: keywords.map((f) => f.keyword),
      seenComments: Object.keys(state.comments).length,
      poller: POLL_MEDIA_IDS.length ? `every ${POLL_INTERVAL_MIN} min on ${POLL_MEDIA_IDS.length} media` : 'off',
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('IG Auto-Reply is running. GET /health for status. Webhook: /webhook\n');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
        log('Webhook rejected: bad signature');
        res.writeHead(401).end('Bad signature');
        return;
      }
      res.writeHead(200).end('EVENT_RECEIVED'); // answer fast, process async
      try {
        handleWebhookBody(JSON.parse(raw.toString('utf8')));
      } catch (e) {
        log('Webhook parse error:', e.message);
      }
    });
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => {
  log(`IG Auto-Reply listening on :${PORT} (dry run: ${DRY_RUN})`);
  log(`Flows: ${keywords.map((f) => f.keyword).join(', ') || 'none'}`);
  if (!PAGE_ACCESS_TOKEN) log('WARNING: PAGE_ACCESS_TOKEN not set — replies will fail until you set it (see .env.example)');
  if (POLL_MEDIA_IDS.length) {
    log(`Poller on: ${POLL_MEDIA_IDS.join(', ')} every ${POLL_INTERVAL_MIN} min`);
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MIN * 60 * 1000);
  } else {
    log('Poller off (set POLL_MEDIA_IDS to enable). Webhook mode only.');
  }
});
