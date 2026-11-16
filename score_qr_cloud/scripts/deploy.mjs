import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = "score-qr";
const dbName = "score-qr";
const accountId = "777998f4d2aedf68ea85860fc3250c58";
const tokenFile = join(root, "admin-token.txt");
const wranglerToml = join(root, "wrangler.toml");

function shellQuote(value) {
  if (!/[^\w@%+=:,./-]/.test(value)) return value;
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function loadOauthToken() {
  const candidates = [
    join(process.env.APPDATA || "", "xdg.config", ".wrangler", "config", "default.toml"),
    join(process.env.HOME || "", ".config", ".wrangler", "config", "default.toml"),
  ];
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error("未检测到 Cloudflare 登录。请先运行: npm exec wrangler login");
}

async function cfApi(method, path, { token, body, raw } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload = body;
  if (body && !raw) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: payload,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`${method} ${path}: ${JSON.stringify(json.errors || json)}`);
  }
  return json;
}

function ensureAdminToken() {
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  const token = randomBytes(12).toString("base64url");
  writeFileSync(tokenFile, `${token}\n`, "utf8");
  console.log("已生成管理口令 → score_qr_cloud/admin-token.txt");
  return token;
}

function upsertDatabaseId(id) {
  let text = readFileSync(wranglerToml, "utf8");
  text = text.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
  writeFileSync(wranglerToml, text, "utf8");
}

function wranglerBin() {
  const local = join(root, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (existsSync(local)) return shellQuote(local);
  return "npx --yes wrangler";
}

function deployWithWrangler(adminToken) {
  const before = readFileSync(wranglerToml, "utf8").replace(/\r?\n\[vars\][\s\S]*$/m, "").trimEnd();
  writeFileSync(wranglerToml, `${before}\n\n[vars]\nSCORE_QR_ADMIN_TOKEN = "${adminToken}"\n`, "utf8");
  const command = `${wranglerBin()} pages deploy public --project-name ${shellQuote(project)} --commit-dirty=true`;
  console.log(`> ${command}`);
  try {
    return execSync(command, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
      env: { ...process.env, CI: "", CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || loadOauthToken() },
    });
  } finally {
    const current = readFileSync(wranglerToml, "utf8");
    const idMatch = current.match(/database_id\s*=\s*"([^"]+)"/);
    writeFileSync(wranglerToml, current.replace(/\r?\n\[vars\][\s\S]*$/m, "").trimEnd() + "\n", "utf8");
    if (idMatch) upsertDatabaseId(idMatch[1]);
  }
}

const oauth = loadOauthToken();
const adminToken = ensureAdminToken();

console.log("查询/创建 D1…");
const listed = await cfApi("GET", `/accounts/${accountId}/d1/database`, { token: oauth });
let db = (listed.result || []).find((row) => row.name === dbName);
if (!db) {
  const created = await cfApi("POST", `/accounts/${accountId}/d1/database`, {
    token: oauth,
    body: { name: dbName },
  });
  db = created.result;
}
const databaseId = db.uuid || db.id;
console.log(`D1 database_id = ${databaseId}`);
upsertDatabaseId(databaseId);

console.log("应用 migrations…");
const sqlPath = join(root, "migrations", "0001_init.sql");
const statements = readFileSync(sqlPath, "utf8")
  .split(";")
  .map((part) => part.trim())
  .filter(Boolean);
for (const sql of statements) {
  await cfApi("POST", `/accounts/${accountId}/d1/database/${databaseId}/query`, {
    token: oauth,
    body: { sql },
  });
}

console.log("确保 Pages 项目存在…");
try {
  await cfApi("GET", `/accounts/${accountId}/pages/projects/${project}`, { token: oauth });
} catch {
  await cfApi("POST", `/accounts/${accountId}/pages/projects`, {
    token: oauth,
    body: { name: project, production_branch: "main" },
  });
}

console.log("部署 Pages（wrangler）…");
let deployOut = "";
try {
  deployOut = deployWithWrangler(adminToken);
  process.stdout.write(deployOut);
} catch (err) {
  console.warn("wrangler pages deploy 失败，尝试提示手动命令：", err.message);
  throw err;
}

// Bind D1 on the project if possible via wrangler config already containing database_id.
const secret = spawnSync(
  `${wranglerBin()} pages secret put SCORE_QR_ADMIN_TOKEN --project-name ${shellQuote(project)}`,
  {
    cwd: root,
    input: adminToken,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, CI: "", CLOUDFLARE_API_TOKEN: oauth },
  },
);
if (secret.status !== 0) {
  console.warn("pages secret put 可选步骤失败（本次部署已带 vars 口令）");
}

const urlMatch = deployOut.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/g);
const fixed = urlMatch ? urlMatch[urlMatch.length - 1].replace(/\/$/, "") : `https://${project}.pages.dev`;
console.log("");
console.log("部署完成。");
console.log(`固定地址: ${fixed}`);
console.log(`实时展示: ${fixed}/live`);
console.log(`扫码入口: ${fixed}/s`);
console.log("管理口令: score_qr_cloud/admin-token.txt");
