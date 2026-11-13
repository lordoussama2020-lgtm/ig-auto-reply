// IG Auto-Reply — Cloudflare Worker version
// ============================================================
// Same logic as server.js, adapted for Cloudflare Workers (free tier,
// NO credit card): no listening socket, no disk — state lives in
// Workers KV (binding SEEN), signatures use Web Crypto, and the
// ~12s reply delay runs in ctx.waitUntil() after the webhook is
// acknowledged. The Graph API calls, Meta rules (7-day window,
// 1 DM per comment, 1 auto DM per user per 24h) and env var names
// are IDENTICAL to server.js.
//
// Deploy: dashboard → Workers & Pages → Create Worker → paste this
// file (or Git-connected deploy with wrangler.toml), create a KV
// namespace and bind it as SEEN, set the secrets (IG_ACCESS_TOKEN,
// VERIFY_TOKEN, APP_SECRET, DRY_RUN) in Settings → Variables.
// Docs: SETUP.md (Worker section).

import keywordsData from './keywords.json';

const GRAPH_VERSION = 'v21.0';
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000; // 7 days
const PER_USER_DM_WINDOW_MS = 24 * 3600 * 1000; // 1 auto DM / user / 24h

const keywords = (keywordsData.flows || []).filter((f) => f.enabled !== false);
const inFlight = new Set(); // comment ids already scheduled in this isolate

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------- keyword matching ----------
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function findFlow(text, mediaId) {
  const clean = normalize(text);
  for (const flow of keywords) {
    if (flow.mediaIds && !flow.mediaIds.includes('all') && mediaId && !flow.mediaIds.includes(mediaId)) {
      continue;
    }
    const kw = normalize(flow.keyword);
    if (!kw) continue;
    if (flow.match === 'exact') {
      if (clean === kw) return flow;
    } else if (clean.includes(kw)) {
      return flow;
    }
  }
  return null;
}

// ---------- KV state ----------
// Shape: { comments: {id: ts}, users: {userId: lastDmTs} } — same as server.js.
function stateKey(env) {
  return env.DRY_RUN === '1' ? 'seen-dryrun' : 'seen';
}

async function loadState(env) {
  try {
    const raw = await env.SEEN.get(stateKey(env));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    log('KV load error:', e.message);
  }
  return { comments: {}, users: {} };
}

async function saveState(env, state) {
  try {
    await env.SEEN.put(stateKey(env), JSON.stringify(state));
  } catch (e) {
    log('KV save error:', e.message);
  }
}

// ---------- Graph API ----------
function cfg(env) {
  return {
    graphBase: env.GRAPH_BASE || `https://graph.instagram.com/${GRAPH_VERSION}`,
    token: env.IG_ACCESS_TOKEN || env.PAGE_ACCESS_TOKEN || '',
    verifyToken: env.VERIFY_TOKEN || 'ig-auto-reply-verify',
    appSecret: env.APP_SECRET || '',
    dryRun: env.DRY_RUN === '1',
    replyDelayMs: parseInt(env.REPLY_DELAY_MS || '12000', 10),
    pollMediaIds: (env.POLL_MEDIA_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

async function graphPost(env, endpointPath, params) {
  const { graphBase, token, dryRun } = cfg(env);
  const body = new URLSearchParams({ ...params, access_token: token });
  if (dryRun) {
    log('[DRY RUN] would POST', endpointPath, '->', JSON.stringify(Object.fromEntries(body.entries())));
    return { id: 'dry-run' };
  }
  const res = await fetch(`${graphBase}${endpointPath}`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API ${endpointPath} failed: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

// ---------- comment pipeline ----------
async function queueComment(env, ctx, comment, state) {
  const { id, text, mediaId, fromId, username } = comment;
  if (!id || !text) return;
  if (state.comments[id] || inFlight.has(id)) {
    log(`Skip ${id} (@${username}): already handled`);
    return;
  }
  const flow = findFlow(text, mediaId);
  if (!flow) return; // not a keyword comment — ignore silently

  const { replyDelayMs } = cfg(env);
  const ageMs = Date.now() - (comment.timestampMs || Date.now());
  if (ageMs > PRIVATE_REPLY_WINDOW_MS) {
    log(`Skip ${id} (@${username}): comment older than 7 days, Meta would reject it (error 551)`);
    state.comments[id] = Date.now();
    await saveState(env, state);
    return;
  }
  if (fromId && state.users[fromId] && Date.now() - state.users[fromId] < PER_USER_DM_WINDOW_MS) {
    log(`Skip ${id} (@${username}): user already got an auto DM in the last 24h`);
    state.comments[id] = Date.now();
    await saveState(env, state);
    return;
  }

  inFlight.add(id);
  log(`Queued "${flow.keyword}" from @${username} on ${mediaId || 'unknown media'} — reply in ${replyDelayMs / 1000}s`);
  // Answer the webhook NOW; do the delayed reply in the background.
  ctx.waitUntil((async () => {
    try {
      await new Promise((r) => setTimeout(r, replyDelayMs));
      if (flow.publicReply) {
        await graphPost(env, `/${id}/replies`, { message: flow.publicReply });
        log(`Public reply sent on ${id}`);
      }
      await graphPost(env, `/${id}/private_replies`, { message: flow.dmMessage });
      log(`DM sent to @${username} for keyword "${flow.keyword}"`);
      const fresh = await loadState(env);
      fresh.comments[id] = Date.now();
      if (fromId) fresh.users[fromId] = Date.now();
      await saveState(env, fresh);
    } catch (e) {
      log(`ERROR replying to ${id}:`, e.message);
      // do NOT mark as seen — a retry (webhook redelivery / next poll) can pick it up
    } finally {
      inFlight.delete(id);
    }
  })());
}

async function handleWebhookBody(env, ctx, body, state) {
  if (body.object !== 'instagram') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const v = change.value || {};
      await queueComment(env, ctx, {
        id: v.id,
        text: v.text,
        mediaId: v.media && v.media.id,
        fromId: v.from && v.from.id,
        username: v.from && v.from.username,
        timestampMs: v.timestamp ? new Date(v.timestamp).getTime() : Date.now(),
      }, state);
    }
  }
}

// ---------- signature (Web Crypto HMAC-SHA256) ----------
async function verifySignature(env, rawBody, signature) {
  const { appSecret } = cfg(env);
  if (!appSecret) return true; // no secret configured — accept (dev only)
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, rawBody);
  const expected = 'sha256=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ---------- poller (Cron Trigger fallback — optional) ----------
async function pollOnce(env, ctx) {
  const { graphBase, token, pollMediaIds } = cfg(env);
  if (!token) {
    log('Poller skipped: IG_ACCESS_TOKEN not set');
    return;
  }
  const state = await loadState(env);
  for (const mediaId of pollMediaIds) {
    try {
      const url = `${graphBase}/${mediaId}/comments?fields=id,text,timestamp,from&limit=50&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        log(`Poll ${mediaId} failed:`, JSON.stringify(data.error || data));
        continue;
      }
      for (const c of data.data || []) {
        await queueComment(env, ctx, {
          id: c.id,
          text: c.text,
          mediaId,
          fromId: c.from && c.from.id,
          username: c.from && c.from.username,
          timestampMs: c.timestamp ? new Date(c.timestamp).getTime() : Date.now(),
        }, state);
      }
    } catch (e) {
      log(`Poll ${mediaId} error:`, e.message);
    }
  }
}

// ---------- entry points ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/webhook') {
      // Meta verification handshake
      const { verifyToken } = cfg(env);
      if (url.searchParams.get('hub.mode') === 'subscribe' &&
          url.searchParams.get('hub.verify_token') === verifyToken) {
        log('Webhook verified by Meta');
        return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const state = await loadState(env);
      const { dryRun, pollMediaIds } = cfg(env);
      return Response.json({
        ok: true,
        dryRun,
        flows: keywords.map((f) => f.keyword),
        seenComments: Object.keys(state.comments).length,
        poller: pollMediaIds.length ? `cron on ${pollMediaIds.length} media` : 'off',
      });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('IG Auto-Reply is running (Cloudflare Worker). GET /health for status. Webhook: /webhook\n');
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const raw = new Uint8Array(await request.arrayBuffer());
      if (!(await verifySignature(env, raw, request.headers.get('x-hub-signature-256')))) {
        log('Webhook rejected: bad signature');
        return new Response('Bad signature', { status: 401 });
      }
      const state = await loadState(env);
      try {
        await handleWebhookBody(env, ctx, JSON.parse(new TextDecoder().decode(raw)), state);
      } catch (e) {
        log('Webhook parse error:', e.message);
      }
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  },

  // Cron Trigger (optional): set a 5-min cron in the dashboard to run
  // the poller when webhooks are not available.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollOnce(env, ctx));
  },
};
