// Sets (or resets) the OWNER's 6-digit passcode. The owner is the first admin and the only one who can add, disable,
// rename or delete the other admins, which is done on the dashboard ("管理员" tab).
//
//   npm run set-admin
//
// The passcode is stored (as a bcrypt hash) in the `admins` table of whichever database .env points at, so the output
// first says which one that is. It also makes sure .env has a JWT_SECRET (needed to sign login cookies).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const ENV_PATH = path.join(__dirname, '..', '.env');
const repo = require('../server/repo');
const v = require('../server/validate');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : text.replace(/\s*$/, '\n') + line + '\n';
}

async function main() {
  const remote = process.env.REMOTE_DB === '1';
  console.log(`数据库：${process.env.DB_HOST}:${process.env.DB_PORT}  ${process.env.DB_NAME}  ${remote ? '【线上数据库（通过隧道）】' : '(本地/当前服务器)'}`);
  if (remote) {
    const yes = await ask('⚠ 这会修改【线上网站】所有者的密码。确定吗？(输入 yes 确认): ');
    if (yes.trim().toLowerCase() !== 'yes') { console.log('已取消。'); return; }
  }

  console.log('\n设置「所有者」的 6 位数字密码（只能是数字，输入时不显示）。\n');
  const code = (await ask('6 位数字密码: ', { hidden: true })).trim();
  try { v.passcode(code); } catch (e) { console.error(e.message); process.exit(1); }
  const again = (await ask('再输入一次: ', { hidden: true })).trim();
  if (again !== code) { console.error('两次输入不一致'); process.exit(1); }

  const result = await repo.setOwnerPasscode(await bcrypt.hash(code, 12));

  // login cookies need a signing secret
  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  if (!/^JWT_SECRET=.+$/m.test(env)) {
    env = setVar(env, 'JWT_SECRET', crypto.randomBytes(48).toString('hex'));
    fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });
  }

  console.log(result === 'created' ? '\n✓ 已创建「所有者」账号。' : '\n✓ 所有者的密码已更新。');
  console.log('   密码只保存了哈希。现在网站不需要重启，新密码马上生效。');
  console.log('   要添加同事的账号：登录后台 → 「管理员」页。');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('出错了：', err.message); process.exit(1); });
