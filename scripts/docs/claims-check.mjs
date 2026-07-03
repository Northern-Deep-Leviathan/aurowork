import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const banned = [
  {
    id: "fork-origin",
    pattern: /\bForked from\b|different-ai|openwork|OpenWork|openwrk|Openwrk/i,
    message: "fork/openwork/openwrk positioning is not current product language",
  },
  {
    id: "cloud-ready",
    pattern: /\bcloud[- ]ready\b|cloud workers?|hosted workers?|AuroWork Cloud|云端就绪|雲端就緒/i,
    message: "cloud/hosted worker claims are outside the local desktop target",
  },
  {
    id: "public-share",
    pattern: /public sharing|share links?|shared bundles?|team templates?|\bDen\b\/team|\bDen\b|公开分享|團隊範本/i,
    message: "public share/team template claims are outside the local desktop target",
  },
  {
    id: "chat-integrations",
    pattern: /WhatsApp|Telegram|Owpenbot|聊天集成|聊天整合/i,
    message: "chat integration claims are outside the local desktop target",
  },
  {
    id: "openpackage",
    pattern: /OpenPackage|opkg install|pnpm dlx opkg/i,
    message: "OpenPackage registry install claims are not supported as current product language",
  },
  {
    id: "cli-parity",
    pattern: /full feature parity|CLI parity|完整.*CLI|完全.*CLI/i,
    message: "full CLI parity claims must not be current product language",
  },
  {
    id: "file-explorer-diff-search",
    pattern: /File explorer.*Search files.*view diffs|文件差异|檔案差異/i,
    message: "file explorer search/diff claims must match the actual UI surface",
  },
];

const claimSurfaceFiles = [
  "README.md",
  "README_ZH.md",
  "README_ZH_hk.md",
  "docs/product/principles.md",
  "docs/architecture/overview.md",
  "docs/architecture/infrastructure.md",
  "docs/design/design-language.md",
  "docs/ops/triage.md",
].map((file) => resolve(root, file)).filter(existsSync);

const findings = [];
for (const file of claimSurfaceFiles) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of banned) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: relative(root, file).replaceAll("\\", "/"),
          line: index + 1,
          id: rule.id,
          message: rule.message,
          text: line.trim(),
        });
      }
    }
  }
}

if (findings.length) {
  console.error("docs:claims:check failed. Unsupported current-product claims found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.id}] ${finding.message}`);
    console.error(`  ${finding.text}`);
  }
  process.exit(1);
}

console.log("docs:claims:check passed");
