// Live progress board (/temporary/live-update): another program on the owner's Mac POSTs a small JSON snapshot every few
// seconds, the page reads the latest one back. Nothing is stored in the database: it is a temporary board, kept in memory
// (a restart of the site simply starts the board empty until the next POST arrives).
//
//   snapshot format:  { "files": [["hosp/admissions.csv.gz", 12219623, 19928140], ...], "ts": 1761500000 }
//                     every entry is [file name, bytes downloaded, total bytes]
const crypto = require('crypto');

const MAX_FILES = 500;
const WINDOW_MS = 5 * 60 * 1000;          // speed is measured over the last 5 minutes
const KEEP_MS = 3 * 60 * 60 * 1000;       // keep 3 hours of samples for the little chart
const MAX_SAMPLES = 4000;

let latest = null;                         // { files, ts, receivedAt }
let samples = [];                          // [{ t, done }]

class BadSnapshot extends Error {}

function parse(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!Array.isArray(b.files)) throw new BadSnapshot('files must be a list');
  if (b.files.length > MAX_FILES) throw new BadSnapshot(`at most ${MAX_FILES} files`);
  const files = b.files.map((row) => {
    if (!Array.isArray(row) || row.length < 3) throw new BadSnapshot('each file must be [name, done, total]');
    const [name, done, total] = row;
    if (typeof name !== 'string' || !name || name.length > 300) throw new BadSnapshot('bad file name');
    const d = Number(done);
    const t = Number(total);
    if (!Number.isFinite(d) || !Number.isFinite(t) || d < 0 || t < 0 || t > 1e15 || d > 1e15) throw new BadSnapshot('bad byte count');
    return [name, Math.round(d), Math.round(t)];
  });
  const ts = Number(b.ts);
  return { files, ts: Number.isFinite(ts) && ts > 0 ? ts : Math.floor(Date.now() / 1000) };
}

const totals = (files) => files.reduce((acc, [, d, t]) => ({ done: acc.done + Math.min(d, t || d), total: acc.total + t }), { done: 0, total: 0 });

function ingest(body, now = Date.now()) {
  const { files, ts } = parse(body);
  const { done } = totals(files);
  // a new download run starts again from a smaller number: forget the old samples so the speed is not negative
  if (samples.length && done < samples[samples.length - 1].done) samples = [];
  samples.push({ t: now, done });
  samples = samples.filter((s) => now - s.t <= KEEP_MS).slice(-MAX_SAMPLES);
  latest = { files, ts, receivedAt: now };
}

// about 120 evenly spaced points for the chart
function chartPoints() {
  if (samples.length <= 120) return samples;
  const step = (samples.length - 1) / 119;
  return Array.from({ length: 120 }, (_, i) => samples[Math.round(i * step)]);
}

function snapshot(now = Date.now()) {
  if (!latest) return { empty: true, files: [], ts: 0, serverTime: now };
  const { done, total } = totals(latest.files);
  let bytesPerMinute = null;
  const cutoff = samples.filter((s) => now - s.t <= WINDOW_MS);
  const first = cutoff[0];
  const last = samples[samples.length - 1];
  if (first && last && last.t - first.t >= 4000) bytesPerMinute = Math.max(0, ((last.done - first.done) / (last.t - first.t)) * 60000);
  return {
    files: latest.files, ts: latest.ts, receivedAt: latest.receivedAt, serverTime: now,
    done, total, bytesPerMinute, chart: chartPoints(),
  };
}

// constant-time check of "Authorization: Bearer <token>"
function tokenMatches(header, expected) {
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { ingest, snapshot, tokenMatches, BadSnapshot };
