// Switch this project between the LOCAL test database and the LIVE (VPS) database.
//
//   npm run use:vps      point .env at the live database (asks for the live DB password the first time)
//   npm run tunnel       open the SSH tunnel to the VPS (leave it running in its own terminal tab)
//   npm run use:local    point .env back at the local test database
//   npm run db:mode      show which database .env points at
//
// The live MySQL only listens on the VPS itself, so the connection always goes through an SSH tunnel:
//   this computer :<tunnel port>  ->  (SSH)  ->  VPS 127.0.0.1:3306
// Passwords are typed here (hidden) and stored only in git-ignored files with 0600 permissions.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const VPS_PROFILE = path.join(ROOT, '.db-vps.json');     // live connection details (incl. password)
const LOCAL_PROFILE = path.join(ROOT, '.db-local.json'); // the local database details, saved before switching

const DB_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

// ---------- small helpers ----------
function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim() || fallback);
    });
  });
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('找不到 .env。请先运行 npm run dev:setup（本地数据库）或参考 .env.example 创建。');
    process.exit(1);
  }
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function getVar(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : text.replace(/\s*$/, '\n') + line + '\n';
}

const writeSecret = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const isRemote = (env) => getVar(env, 'REMOTE_DB') === '1';

// ---------- commands ----------
function status() {
  const env = readEnv();
  const where = `${getVar(env, 'DB_HOST')}:${getVar(env, 'DB_PORT')}  数据库 ${getVar(env, 'DB_NAME')}  用户 ${getVar(env, 'DB_USER')}`;
  if (isRemote(env)) {
    console.log(`⚠ 当前连接：线上数据库（通过 SSH 隧道）\n  ${where}\n  记得先运行 npm run tunnel，并留意：修改会直接影响真实网站。`);
  } else {
    console.log(`当前连接：本地测试数据库\n  ${where}`);
  }
}

async function useVps() {
  let env = readEnv();
  let profile = readJson(VPS_PROFILE);

  if (!profile) {
    console.log('第一次连接线上数据库，需要填几项信息（直接回车 = 使用方括号里的默认值）：\n');
    const ssh = await ask('VPS 的 SSH 登录 [root@216.219.95.253]: ', { fallback: 'root@216.219.95.253' });
    const port = await ask('本地隧道端口 [3308]: ', { fallback: '3308' });
    const user = await ask('线上数据库用户名 [m.boutiquehomes]: ', { fallback: 'm.boutiquehomes' });
    const name = await ask('线上数据库名 [m.boutiquehomes]: ', { fallback: 'm.boutiquehomes' });
    const password = await ask('线上数据库密码（输入时不显示）: ', { hidden: true });
    if (!password) { console.error('密码不能为空'); process.exit(1); }
    if (!/^\d+$/.test(port) || Number(port) === 3306 || Number(port) === 3307) {
      console.error('隧道端口必须是数字，且不能是 3306/3307（已被数据库占用）');
      process.exit(1);
    }
    profile = { ssh, port, user, name, password };
  }

  const answer = await ask('\n⚠ 切换后，本地网站和后台改的都是【真实线上数据】，无法撤销。确定吗？(输入 yes 确认): ');
  if (answer.toLowerCase() !== 'yes') { console.log('已取消，什么都没有改。'); return; }

  // remember the local database settings so "use:local" can restore them
  if (!isRemote(env)) {
    writeSecret(LOCAL_PROFILE, Object.fromEntries(DB_KEYS.map((k) => [k, getVar(env, k)])));
  }
  writeSecret(VPS_PROFILE, profile);

  env = setVar(env, 'DB_HOST', '127.0.0.1');
  env = setVar(env, 'DB_PORT', profile.port);
  env = setVar(env, 'DB_USER', profile.user);
  env = setVar(env, 'DB_PASSWORD', profile.password);
  env = setVar(env, 'DB_NAME', profile.name);
  env = setVar(env, 'REMOTE_DB', '1');
  fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });

  console.log('\n✓ .env 已切换到【线上数据库】。接下来：');
  console.log('  1) 新开一个终端标签页，运行  npm run tunnel   （输入 VPS 密码，然后别关这个窗口）');
  console.log('  2) 回到这里运行  npm start');
  console.log('  用完后运行  npm run use:local  切回本地测试库。');
}

function useLocal() {
  let env = readEnv();
  const local = readJson(LOCAL_PROFILE);
  if (!local) {
    if (!isRemote(env)) { console.log('已经是本地数据库了，什么都不用改。'); return; }
    console.error('找不到之前保存的本地数据库设置。请运行 npm run dev:setup 重新生成。');
    process.exit(1);
  }
  for (const k of DB_KEYS) env = setVar(env, k, local[k]);
  env = setVar(env, 'REMOTE_DB', '0');
  fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });
  console.log('✓ .env 已切回本地测试数据库。（本地数据库没在运行的话：npm run dev:db）');
}

function tunnel() {
  const profile = readJson(VPS_PROFILE);
  if (!profile) { console.error('还没有配置线上连接，请先运行 npm run use:vps'); process.exit(1); }
  console.log(`正在打开 SSH 隧道：本机 ${profile.port}  →  ${profile.ssh} 上的 MySQL(3306)`);
  console.log('如果提示输入密码，请输入 VPS 的登录密码。连上后这个窗口会一直停着，这是正常的；按 Ctrl+C 关闭隧道。\n');
  const child = spawn(
    'ssh',
    ['-N', '-L', `${profile.port}:127.0.0.1:3306`, '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', profile.ssh],
    { stdio: 'inherit' }
  );
  child.on('exit', (code) => process.exit(code || 0));
}

const commands = { status, vps: useVps, local: useLocal, tunnel };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error('用法：node scripts/use-db.js <status|vps|local|tunnel>');
  process.exit(1);
}
Promise.resolve(commands[cmd]()).catch((err) => {
  console.error('出错了：', err.message);
  process.exit(1);
});
