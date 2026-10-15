#!/usr/bin/env node
// Tough & J's home-PC server (locked down). Plain Node 18+, no npm install. Run it on your PC, phone on the SAME Wi-Fi.
//   node tj-home-server.mjs
// Security model:
//   * EVERY request needs a long random token (Authorization: Bearer <token>, or X-Token header; ?token= only for GET and downloads).
//     Missing/wrong token -> 401. Compared in constant time. Repeated failures lock that address out for 15 minutes (429).
//   * The token is made on first run and kept in ~/.tj-home-server/token.txt (mode 0600), never inside this folder or any repo.
//   * Listens only on your private LAN address(es) + localhost (not on the internet side). Non-LAN callers are dropped.
//   * CORS only for the arcade (https://awfulchunk.github.io and the app's own page). Other browser origins get 403.
//   * No directory listing, no file serving by path. Uploads use generated ids; names are sanitised and kept inside the upload folder.
// Jobs:
//   1) CARTRIDGE UPLOAD: /u/init, /u/chunk, /u/finish (resumable, 4 MB chunks) into ./tj-uploads/
//   2) NEEDLE: /api/pull-file, /api/transcode, /api/convert (need ffmpeg, and yt-dlp for links)
// Options:  --port 8765   --token <long token, 24+ chars>   --dir <upload folder>   --host <ip>   --origin <https://site>  (repeatable)
//           --show-token (print the token again)   --config-dir <folder for the token file>
// Env equivalents: PORT, TJ_TOKEN, DIR
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
const flags = (n) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]] : []));
const PORT = +(flag('port') || process.env.PORT || 8765);
const DIR = path.resolve(flag('dir') || process.env.DIR || path.join(HERE, 'tj-uploads'));
const TMP = path.join(DIR, '.partial');
fs.mkdirSync(TMP, { recursive: true });
const ORIGINS = new Set(['https://awfulchunk.github.io', 'null', 'file://', ...flags('origin')]); // 'null' / 'file://' = the Android app's own page

// ---------- token ----------
const CONF = path.resolve(flag('config-dir') || path.join(os.homedir(), '.tj-home-server'));
const TOKFILE = path.join(CONF, 'token.txt');
let TOKEN = flag('token') || process.env.TJ_TOKEN || '';
let FRESH = false;
const FROMFLAG = !!(flag('token') || process.env.TJ_TOKEN);
if (TOKEN && TOKEN.length < 24) { console.error('The token must be at least 24 characters. Leave --token off to get a random 64-character one.'); process.exit(1); }
if (!TOKEN) {
  try { TOKEN = fs.readFileSync(TOKFILE, 'utf8').trim(); } catch {}
  if (TOKEN && TOKEN.length < 24) TOKEN = ''; // old weak token: replace it
}
if (!TOKEN) {
  TOKEN = crypto.randomBytes(32).toString('hex'); FRESH = true;
  fs.mkdirSync(CONF, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKFILE, TOKEN + '\n', { mode: 0o600 });
  try { fs.chmodSync(TOKFILE, 0o600); fs.chmodSync(CONF, 0o700); } catch {}
}
const TOKHASH = crypto.createHash('sha256').update(TOKEN).digest();
const tokenOk = (given) => { const g = crypto.createHash('sha256').update(String(given || '')).digest(); return crypto.timingSafeEqual(g, TOKHASH); };

const has = (cmd) => { try { return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0 || spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
const HAVE_FFMPEG = has('ffmpeg'), HAVE_YTDLP = has('yt-dlp');

// ---------- helpers ----------
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const safeName = (n) => {
  let o = String(n || 'file').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+/, '_').replace(/[.\s]+$/, '').slice(0, 180) || 'file';
  if (RESERVED.test(o)) o = '_' + o;
  return o;
};
const inside = (dir, p) => { const r = path.resolve(p); return r === path.resolve(dir) || r.startsWith(path.resolve(dir) + path.sep); };
const uniq = (dir, name) => { let out = name, i = 1; const ext = path.extname(name), base = path.basename(name, ext); while (fs.existsSync(path.join(dir, out))) out = `${base} (${i++})${ext}`; return out; };
const baseHeaders = (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); };
const cors = (req, res) => {
  baseHeaders(res);
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,x-token,content-type,accept,x-needle-name,x-needle-format,x-needle-bitrate');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'X-Needle-Filename, X-Needle-Title');
    res.setHeader('Access-Control-Max-Age', '600');
  }
};
const json = (res, code, obj) => { cors(res.req, res); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const text = (res, code, t) => { cors(res.req, res); res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(t); };
const readBody = (req, limit = 64 * 1024) => new Promise((ok, no) => { let n = 0; const a = []; req.on('data', (c) => { n += c.length; if (n > limit) { no(new Error('too big')); req.destroy(); } else a.push(c); }); req.on('end', () => ok(Buffer.concat(a))); req.on('error', no); });

// ---------- LAN only ----------
const isPrivateIp = (ip) => {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0; }
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd'); }
  return false;
};

// ---------- failed-attempt rate limit ----------
const FAILS = new Map(); // ip -> {n, first, lockUntil}
const MAXFAIL = +(flag('max-fail') || 8), WINDOW = 10 * 60e3, LOCK = 15 * 60e3;
const locked = (ip) => { const f = FAILS.get(ip); return !!(f && f.lockUntil > Date.now()); };
const fail = (ip) => {
  const now = Date.now(); let f = FAILS.get(ip);
  if (!f || now - f.first > WINDOW) f = { n: 0, first: now, lockUntil: 0 };
  f.n++; if (f.n >= MAXFAIL) f.lockUntil = now + LOCK;
  FAILS.set(ip, f); return f;
};
setInterval(() => { const now = Date.now(); for (const [k, f] of FAILS) if (f.lockUntil < now && now - f.first > WINDOW) FAILS.delete(k); }, 60e3).unref();

function tokenFrom(req, url) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) return m[1].trim();
  if (req.headers['x-token']) return String(req.headers['x-token']);
  // query token: downloads and GET only (it can end up in logs, so not for uploads)
  if (url.searchParams.has('token') && (req.method === 'GET' || url.pathname === '/api/pull-file')) return url.searchParams.get('token');
  return '';
}

// ---------- Cartridge upload (resumable) ----------
const upId = (name, size) => crypto.createHash('sha1').update(name + '\0' + size).digest('hex').slice(0, 16);
async function upload(req, res, url) {
  const p = url.pathname;
  if (p === '/u/init' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString() || '{}');
    const name = safeName(b.name), size = Math.max(0, Math.min(+b.size || 0, 50 * 1024 ** 3)), id = upId(name, size), f = path.join(TMP, id + '.part');
    const received = fs.existsSync(f) ? fs.statSync(f).size : 0;
    fs.writeFileSync(path.join(TMP, id + '.json'), JSON.stringify({ name, size }));
    return json(res, 200, { id, received: Math.min(received, size) });
  }
  const id = (url.searchParams.get('id') || '').replace(/[^a-f0-9]/g, '');
  if (p !== '/u/init' && id.length !== 16) return json(res, 400, { error: 'bad id' });
  const meta = () => { try { return JSON.parse(fs.readFileSync(path.join(TMP, id + '.json'), 'utf8')); } catch { return null; } };
  if (p === '/u/chunk' && req.method === 'PUT') {
    const m = meta(); if (!m) return json(res, 404, { error: 'unknown upload' });
    if (+req.headers['content-length'] > 16 * 1024 * 1024) return json(res, 413, { error: 'chunk too big (max 16 MB)' });
    const f = path.join(TMP, id + '.part'); const have = fs.existsSync(f) ? fs.statSync(f).size : 0;
    const off = +url.searchParams.get('offset') || 0;
    if (off !== have) { await new Promise((r) => { req.on('data', () => {}); req.on('end', r); }); return json(res, 409, { received: have }); }
    await new Promise((ok, no) => { const w = fs.createWriteStream(f, { flags: 'a' }); req.pipe(w); w.on('finish', ok); w.on('error', no); req.on('error', no); });
    return json(res, 200, { received: fs.statSync(f).size });
  }
  if (p === '/u/finish' && req.method === 'POST') {
    const m = meta(); if (!m) return json(res, 404, { error: 'unknown upload' });
    const f = path.join(TMP, id + '.part'); const have = fs.existsSync(f) ? fs.statSync(f).size : 0;
    if (m.size && have !== m.size) return json(res, 409, { error: 'incomplete', received: have, size: m.size });
    const name = uniq(DIR, safeName(m.name)); const dest = path.join(DIR, name); if (!inside(DIR, dest) || dest === TMP) return json(res, 400, { error: 'bad name' }); fs.renameSync(f, dest); try { fs.unlinkSync(path.join(TMP, id + '.json')); } catch {}
    console.log(new Date().toLocaleTimeString(), 'received', name, (have / 1048576).toFixed(1) + ' MB');
    return json(res, 200, { name, size: have });
  }
  return json(res, 404, { error: 'not found' });
}

// ---------- Needle ----------
const run = (cmd, args, input) => new Promise((ok, no) => { const c = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); const o = [], e = []; c.stdout.on('data', (d) => o.push(d)); c.stderr.on('data', (d) => e.push(d)); c.on('error', no); c.on('close', (code) => code === 0 ? ok(Buffer.concat(o)) : no(new Error(Buffer.concat(e).toString().split('\n').slice(-4).join(' ').slice(0, 300) || 'exit ' + code))); if (input) { c.stdin.on('error', () => {}); c.stdin.end(input); } });
const fmtArgs = (fmt, kbps) => fmt === 'wav' ? ['-c:a', 'pcm_s16le', '-f', 'wav'] : fmt === 'ogg' ? ['-c:a', 'libvorbis', '-b:a', kbps + 'k', '-f', 'ogg'] : fmt === 'm4a' ? ['-c:a', 'aac', '-b:a', kbps + 'k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4'] : ['-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-f', 'mp3'];
async function needle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/transcode' && req.method === 'POST') { // any audio in, wav out (so the phone can draw it)
    if (!HAVE_FFMPEG) return text(res, 501, 'ffmpeg is not installed on the PC');
    const body = await readBody(req, 512 * 1024 * 1024);
    const out = await run('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vn', '-f', 'wav', 'pipe:1'], body);
    cors(req, res); res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(out);
  }
  if (p === '/api/convert' && req.method === 'POST') {
    if (!HAVE_FFMPEG) return text(res, 501, 'ffmpeg is not installed on the PC');
    const fmt = String(req.headers['x-needle-format'] || 'mp3'), kbps = +req.headers['x-needle-bitrate'] || 192;
    const body = await readBody(req, 512 * 1024 * 1024);
    const out = await run('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vn', ...fmtArgs(fmt, kbps), 'pipe:1'], body);
    cors(req, res); res.writeHead(200, { 'content-type': fmt === 'mp3' ? 'audio/mpeg' : 'application/octet-stream' }); return res.end(out);
  }
  if (p === '/api/pull-file' && req.method === 'POST') { // {url, kind: audio|video, source, bitrate, quality, adult, audioFormat}
    const o = JSON.parse((await readBody(req)).toString() || '{}');
    if (!/^https?:\/\//i.test(o.url || '')) return text(res, 400, 'Paste a full https link.');
    try { // never let the PC be used to poke other machines on the home network
      const host = new URL(o.url).hostname.replace(/^\[|\]$/g, '');
      const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return text(res, 400, 'That link points at a private address, which is blocked.');
    } catch { return text(res, 400, 'That link could not be looked up.'); }
    const kind = o.kind === 'video' ? 'video' : 'audio', fmt = ['mp3', 'm4a', 'wav', 'ogg'].includes(o.audioFormat) ? o.audioFormat : 'mp3', kbps = [128, 192, 256].includes(+o.bitrate) ? +o.bitrate : 192;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-'));
    try {
      let file, title;
      if (HAVE_YTDLP) {
        const args = ['--no-playlist', '--no-progress', '-o', path.join(work, '%(title).120B.%(ext)s'), '--print', 'after_move:filepath'];
        if (kind === 'audio') args.push('-x', '--audio-format', fmt, '--audio-quality', kbps + 'K');
        else args.push('-S', `res:${+o.quality || 720}`, '--merge-output-format', 'mp4');
        args.push(o.url);
        const out = (await run('yt-dlp', args)).toString().trim().split('\n').pop();
        file = out; title = path.basename(out, path.extname(out));
      } else { // no yt-dlp: only direct file links work
        const r = await fetch(o.url, { redirect: 'follow' }); if (!r.ok) return text(res, 502, 'The link answered ' + r.status);
        const nm = safeName(decodeURIComponent(path.basename(new URL(r.url).pathname)) || 'download'); file = path.join(work, nm);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); title = path.basename(nm, path.extname(nm));
        if (kind === 'audio' && HAVE_FFMPEG && path.extname(nm).slice(1).toLowerCase() !== fmt) { const f2 = path.join(work, title + '.' + fmt); await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', ...fmtArgs(fmt, kbps).slice(0, -2), f2]); file = f2; }
      }
      const buf = fs.readFileSync(file), name = path.basename(file);
      cors(req, res); res.writeHead(200, { 'content-type': kind === 'video' ? 'video/mp4' : 'application/octet-stream', 'X-Needle-Filename': encodeURIComponent(name), 'X-Needle-Title': encodeURIComponent(title), 'content-length': buf.length });
      return res.end(buf);
    } catch (e) { return text(res, 502, String(e.message || e).slice(0, 300)); }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
  }
  return json(res, 404, { error: 'not found' });
}

async function handle(req, res) {
  const ip = req.socket.remoteAddress || '';
  baseHeaders(res);
  if (!isPrivateIp(ip)) { req.socket.destroy(); return; } // not from the home network
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  try {
    if (req.method === 'OPTIONS') { // preflight carries no secrets and no token (browsers cannot add one)
      if (origin && !ORIGINS.has(origin)) { res.writeHead(403); return res.end(); }
      cors(req, res); res.writeHead(204); return res.end();
    }
    if (origin && !ORIGINS.has(origin)) return json(res, 403, { error: 'origin not allowed' });
    if (locked(ip)) { res.setHeader('Retry-After', '900'); return json(res, 429, { error: 'too many wrong tries, wait 15 minutes' }); }
    if (!tokenOk(tokenFrom(req, url))) {
      const f = fail(ip); console.log(new Date().toLocaleTimeString(), 'rejected (bad or missing token) from', ip, f.n >= MAXFAIL ? '- LOCKED OUT 15 min' : '');
      return json(res, 401, { error: 'unauthorized' });
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'tough-upload', ffmpeg: HAVE_FFMPEG, ytdlp: HAVE_YTDLP });
    if (url.pathname.startsWith('/u/')) return await upload(req, res, url);
    if (url.pathname.startsWith('/api/')) return await needle(req, res, url);
    return json(res, 404, { error: 'not found' });
  } catch (e) { try { json(res, 500, { error: 'server error' }); } catch {} }
}

const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && isPrivateIp(i.address)).map((i) => i.address);
const hosts = flag('host') ? [flag('host')] : [...new Set(['127.0.0.1', ...lanIps()])];
let up = 0;
for (const h of hosts) {
  const srv = http.createServer(handle);
  srv.requestTimeout = 0; srv.headersTimeout = 20000; srv.maxHeadersCount = 50;
  srv.on('error', (e) => console.error('Could not listen on', h + ':' + PORT, '-', e.code || e.message));
  srv.listen(PORT, h, () => {
    up++;
    if (up === 1) {
      console.log("\nTough & J's home server is up (locked down).\n");
      for (const x of hosts.filter((x) => x !== '127.0.0.1')) console.log('  Address for the phone:  http://' + x + ':' + PORT);
      if (FRESH || argv.includes('--show-token')) console.log('  Token (secret, paste it into the app):\n    ' + TOKEN);
      else if (FROMFLAG) console.log('  Token: the one you gave with --token (not written to disk)');
      else console.log('  Token: saved in ' + TOKFILE + '  (run with --show-token to print it)');
      if (FRESH && !FROMFLAG) console.log('  (First run: this token was just created. Keep it private.)');
      console.log('  Uploads go to:          ' + DIR);
      console.log('  Only your home network can reach it; every request needs the token.');
      console.log('  ffmpeg: ' + (HAVE_FFMPEG ? 'found' : 'NOT found (Needle convert/transcode off)') + ' | yt-dlp: ' + (HAVE_YTDLP ? 'found' : 'NOT found (Needle: direct file links only)') + '\n');
    }
  });
}
