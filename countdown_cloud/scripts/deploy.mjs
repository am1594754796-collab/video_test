import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = join(root, "..");
const project = "classroom-countdown";
const publicDir = join(root, "public");
const source = join(projectRoot, "countdown.html");
const target = join(publicDir, "index.html");

mkdirSync(publicDir, { recursive: true });
if (!existsSync(source)) throw new Error(`缺少 ${source}`);
copyFileSync(source, target);

const wranglerCandidates = [
  join(projectRoot, "score_qr_cloud", "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler"),
  join(root, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler"),
];
const wrangler = wranglerCandidates.find((p) => existsSync(p));
if (!wrangler) {
  throw new Error("找不到 wrangler。请先在 score_qr_cloud 目录执行 npm install，或本目录 npm install wrangler。");
}

function runWrangler(args) {
  console.log(`> ${wrangler} ${args.join(" ")}`);
  const result = spawnSync(wrangler, args, { cwd: root, encoding: "utf8", shell: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

let result = runWrangler(["pages", "deploy", "public", "--project-name", project, "--commit-dirty=true"]);
const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
if (result.status !== 0 && /does not exist/i.test(combined)) {
  const created = runWrangler(["pages", "project", "create", project, "--production-branch", "main"]);
  if (created.status !== 0) process.exit(created.status || 1);
  result = runWrangler(["pages", "deploy", "public", "--project-name", project, "--commit-dirty=true"]);
}
if (result.status !== 0) process.exit(result.status || 1);

console.log("");
console.log("部署完成。永久公开倒计时（电脑可关机）：");
console.log(`https://${project}.pages.dev/`);

