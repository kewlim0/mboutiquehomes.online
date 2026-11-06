// Listing videos: the admin uploads any phone video (MOV / HEVC / MP4 ...), this file turns it into a plain MP4 (H.264 + AAC) that
// plays everywhere, plus a still picture for the cover. The conversion runs in the background, one video at a time (the server is small).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const TMP_DIR = path.join(__dirname, '..', 'private-files', 'video-tmp');   // never served
const MAX_SECONDS = 15 * 60;
const jobs = new Map();   // id -> { state: 'queued' | 'processing' | 'done' | 'error', progress, src, poster, error, at }
const queue = [];
let running = false;
let available = null;

fs.mkdirSync(TMP_DIR, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { force: true });   // half-finished uploads of an earlier run

function run(cmd, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; if (onLine) String(d).split('\n').forEach((l) => l && onLine(l)); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `${cmd} exited with ${code}`))));
  });
}

// is ffmpeg installed on this machine? (asked once)
async function isAvailable() {
  if (available !== null) return available;
  try { await run('ffmpeg', ['-version']); await run('ffprobe', ['-version']); available = true; } catch (e) { available = false; }
  return available;
}

async function convert(job, input) {
  const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input]));
  const video = (info.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) throw new Error('这个文件里没有视频画面，请选择视频文件');
  const seconds = Number(info.format?.duration) || 0;
  if (/image2|_pipe|gif|apng/.test(info.format?.format_name || '') || seconds < 0.5) throw new Error('这是图片或太短的文件，请选择视频文件');
  if (seconds > MAX_SECONDS) throw new Error(`视频太长（最长 ${MAX_SECONDS / 60} 分钟）`);

  const name = crypto.randomBytes(16).toString('hex');
  const out = path.join(UPLOAD_DIR, `${name}.mp4`), poster = path.join(UPLOAD_DIR, `${name}.jpg`);
  const tmpOut = out + '.part';
  try {
    // long side at most 1280 px; H.264 + AAC; "faststart" so it can start playing before it is fully downloaded
    await run('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      '-f', 'mp4', '-progress', 'pipe:1', tmpOut], {
      onLine: (l) => {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && seconds) job.progress = Math.min(99, Math.round((Number(m[1]) / 1e6 / seconds) * 100));
      },
    });
    fs.renameSync(tmpOut, out);
    await run('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-ss', String(Math.min(1, seconds / 2)), '-i', out, '-frames:v', '1',
      '-vf', "scale='min(900,iw)':-2", '-q:v', '4', poster]);
  } catch (err) {
    for (const f of [tmpOut, out, poster]) fs.rmSync(f, { force: true });
    throw err;
  }
  job.src = `uploads/${name}.mp4`;
  job.poster = fs.existsSync(poster) ? `uploads/${name}.jpg` : '';
}

async function next() {
  if (running) return;
  const item = queue.shift();
  if (!item) return;
  running = true;
  const { job, input } = item;
  job.state = 'processing';
  try {
    await convert(job, input);
    job.state = 'done'; job.progress = 100;
  } catch (err) {
    job.state = 'error';
    job.error = /^[一-龥]/.test(err.message) ? err.message : '这个视频无法转换，请换一个文件试试';
    console.warn('video conversion failed:', err.message);
  } finally {
    fs.rm(input, { force: true }, () => {});
    running = false;
    setImmediate(next);
  }
}

// `input` is the uploaded file (already inside TMP_DIR); returns the job id to poll
function submit(input) {
  const id = crypto.randomBytes(12).toString('hex');
  const job = { state: 'queued', progress: 0, at: Date.now() };
  jobs.set(id, job);
  queue.push({ job, input });
  for (const [k, j] of jobs) if (Date.now() - j.at > 3600 * 1000 && j.state !== 'processing') jobs.delete(k);
  next();
  return id;
}

function status(id) {
  const j = jobs.get(id);
  if (!j) return null;
  return { state: j.state, progress: j.progress, src: j.src, poster: j.poster, error: j.error };
}

module.exports = { TMP_DIR, isAvailable, submit, status };
