// Local development database: a real MySQL server that belongs to this project only.
// Data lives in ./.mysql/ (git-ignored) and it listens on 127.0.0.1:3307, so it never touches
// any MySQL you already run on port 3306.
//
//   npm run dev:setup      first time: creates the server, database, user, .env and loads the default content
//   npm run dev:db         start it again later (e.g. after a reboot)
//   npm run dev:db:stop    stop it
//   npm run dev:db:status  is it running?
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.mysql');
const DATA = path.join(DIR, 'data');
const SOCKET = path.join(DIR, 'mysql.sock');
const PIDFILE = path.join(DIR, 'mysqld.pid');
const LOGFILE = path.join(DIR, 'mysqld.log');
const ROOT_PW_FILE = path.join(DIR, 'root-password');
const ENV_PATH = path.join(ROOT, '.env');

const PORT = 3307;
const DB_NAME = 'm.boutiquehomes';
const LEGACY_DB_NAME = 'luxe_realty'; // earlier name; its tables are moved to the new database by setup
const DB_USER = 'm.boutiquehomes';
const LEGACY_DB_USER = 'luxe_app'; // earlier name, removed by setup if it still exists

// ---------- helpers ----------
function findMysqld() {
  const candidates = [
    process.env.MYSQLD,
    '/opt/homebrew/opt/mysql/bin/mysqld',
    '/usr/local/opt/mysql/bin/mysqld',
    '/usr/sbin/mysqld',
    '/usr/local/mysql/bin/mysqld',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const which = spawnSync('which', ['mysqld'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

function basedirOf(mysqld) {
  // .../opt/mysql/bin/mysqld -> .../opt/mysql
  return path.dirname(path.dirname(fs.realpathSync(mysqld)));
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PIDFILE, 'utf8').trim());
    process.kill(pid, 0); // throws if the process does not exist
    return pid;
  } catch (e) {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(password) {
  return mysql.createConnection({ host: '127.0.0.1', port: PORT, user: 'root', password, multipleStatements: true });
}

async function waitReady(password = '', tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const conn = await connect(password);
      await conn.end();
      return true;
    } catch (e) {
      // Access denied still means the server is up (we just used the wrong root password)
      if (e.code === 'ER_ACCESS_DENIED_ERROR') return true;
      await sleep(500);
    }
  }
  return false;
}

function envValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

function setEnvVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : text.replace(/\s*$/, '\n') + line + '\n';
}

// ---------- commands ----------
async function start() {
  const mysqld = findMysqld();
  if (!mysqld) {
    console.error('找不到 MySQL 程序。请先安装：brew install mysql   （或用环境变量 MYSQLD 指定 mysqld 的路径）');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DATA, 'mysql'))) {
    console.error('数据库还没初始化，请先运行：npm run dev:setup');
    process.exit(1);
  }
  if (readPid()) {
    console.log(`• 开发数据库已经在运行（端口 ${PORT}）`);
    return;
  }

  const out = fs.openSync(LOGFILE, 'a');
  const child = spawn(
    mysqld,
    [
      '--no-defaults',
      `--basedir=${basedirOf(mysqld)}`,
      `--datadir=${DATA}`,
      `--port=${PORT}`,
      '--bind-address=127.0.0.1',
      `--socket=${SOCKET}`,
      '--mysqlx=OFF',
      `--pid-file=${PIDFILE}`,
    ],
    { detached: true, stdio: ['ignore', out, out] }
  );
  child.unref();

  const rootPw = fs.existsSync(ROOT_PW_FILE) ? fs.readFileSync(ROOT_PW_FILE, 'utf8').trim() : '';
  if (!(await waitReady(rootPw))) {
    console.error(`启动失败，请查看日志：${LOGFILE}`);
    process.exit(1);
  }
  console.log(`✓ 开发数据库已启动（127.0.0.1:${PORT}）`);
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('• 开发数据库没有在运行');
    return;
  }
  process.kill(pid, 'SIGTERM'); // mysqld shuts down cleanly on SIGTERM
  for (let i = 0; i < 60 && readPid(); i++) await sleep(500);
  console.log(readPid() ? '⚠ 关闭超时，请稍后再试' : '✓ 开发数据库已关闭（数据保留在 .mysql/ 里）');
}

function status() {
  const pid = readPid();
  console.log(pid ? `运行中（进程 ${pid}，127.0.0.1:${PORT}，数据库 ${DB_NAME}）` : '未运行（用 npm run dev:db 启动）');
}

async function setup() {
  const mysqld = findMysqld();
  if (!mysqld) {
    console.error('找不到 MySQL 程序。请先安装：brew install mysql   （或用环境变量 MYSQLD 指定 mysqld 的路径）');
    process.exit(1);
  }
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

  // 1) initialise the data directory (first time only)
  if (!fs.existsSync(path.join(DATA, 'mysql'))) {
    console.log('… 正在初始化数据库文件（只需要一次）');
    const init = spawnSync(
      mysqld,
      ['--no-defaults', '--initialize-insecure', `--basedir=${basedirOf(mysqld)}`, `--datadir=${DATA}`],
      { encoding: 'utf8' }
    );
    if (init.status !== 0) {
      console.error('初始化失败：\n' + (init.stderr || init.stdout));
      process.exit(1);
    }
    console.log('✓ 数据库文件已创建');
  }

  // 2) start the server
  await start();

  // 3) root password (random, kept in .mysql/root-password) + database + app user
  let rootPw = fs.existsSync(ROOT_PW_FILE) ? fs.readFileSync(ROOT_PW_FILE, 'utf8').trim() : '';
  let conn;
  try {
    conn = await connect(rootPw);
  } catch (e) {
    console.error('无法用保存的 root 密码登录开发数据库。如需重来，请先 npm run dev:db:stop，再删除 .mysql 文件夹后重新 setup。');
    process.exit(1);
  }
  if (!rootPw) {
    rootPw = crypto.randomBytes(16).toString('hex');
    await conn.query('ALTER USER ?@? IDENTIFIED BY ?', ['root', 'localhost', rootPw]);
    fs.writeFileSync(ROOT_PW_FILE, rootPw, { mode: 0o600 });
    await conn.end();
    conn = await connect(rootPw);
  }

  const existingEnv = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const reuse = envValue(existingEnv, 'DB_PORT') === String(PORT) && envValue(existingEnv, 'DB_PASSWORD');
  const appPw = reuse || crypto.randomBytes(16).toString('hex');

  for (const host of ['localhost', '127.0.0.1']) {
    await conn.query('DROP USER IF EXISTS ?@?', [LEGACY_DB_USER, host]);
  }
  // Database renamed: move the tables (and so the data) from the old database to the new one
  const [dbs] = await conn.query('SHOW DATABASES');
  const names = dbs.map((r) => r.Database);
  if (names.includes(LEGACY_DB_NAME) && !names.includes(DB_NAME)) {
    await conn.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const [tables] = await conn.query('SHOW TABLES FROM `' + LEGACY_DB_NAME + '`');
    for (const row of tables) {
      const t = Object.values(row)[0];
      await conn.query(`RENAME TABLE \`${LEGACY_DB_NAME}\`.\`${t}\` TO \`${DB_NAME}\`.\`${t}\``);
    }
    await conn.query(`DROP DATABASE \`${LEGACY_DB_NAME}\``);
    console.log(`✓ 已把数据库 ${LEGACY_DB_NAME} 改名为 ${DB_NAME}（数据完整保留）`);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const host of ['localhost', '127.0.0.1']) {
    await conn.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [DB_USER, host, appPw]);
    await conn.query('ALTER USER ?@? IDENTIFIED BY ?', [DB_USER, host, appPw]);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO ?@?`, [DB_USER, host]);
  }
  await conn.end();
  console.log(`✓ 数据库 ${DB_NAME} 和用户 ${DB_USER} 已就绪`);

  // 4) .env (keeps any admin account / secrets that are already there)
  let env = existingEnv || fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  env = setEnvVar(env, 'DB_HOST', '127.0.0.1');
  env = setEnvVar(env, 'DB_PORT', String(PORT));
  env = setEnvVar(env, 'DB_USER', DB_USER);
  env = setEnvVar(env, 'DB_PASSWORD', appPw);
  env = setEnvVar(env, 'DB_NAME', DB_NAME);
  env = setEnvVar(env, 'REMOTE_DB', '0');
  if (!/^JWT_SECRET=.+$/m.test(env)) env = setEnvVar(env, 'JWT_SECRET', crypto.randomBytes(48).toString('hex'));
  fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });
  console.log('✓ .env 已写好（数据库连接信息）');

  // 5) tables + default content (only when the tables are empty)
  execFileSync(process.execPath, [path.join(__dirname, 'init-db.js')], { stdio: 'inherit', cwd: ROOT });

  console.log('\n全部完成。下一步：');
  console.log('  1) npm run set-admin    设置后台账号（如果还没设置过）');
  console.log('  2) npm start            打开 http://localhost:3000   后台 http://localhost:3000/admin');
}

const commands = { setup, start, stop, status };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error('用法：node scripts/dev-db.js <setup|start|stop|status>');
  process.exit(1);
}
Promise.resolve(commands[cmd]())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('出错了：', err.message);
    process.exit(1);
  });
