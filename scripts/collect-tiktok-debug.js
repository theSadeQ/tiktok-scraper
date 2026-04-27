const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const username = process.argv[2];
const number = process.argv[3] || "30";

if (!username) {
  console.error("Usage: node scripts/collect-tiktok-debug.js <username> [number]");
  process.exit(1);
}

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "output");
const reportDir = path.join(rootDir, "debug-report");

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const reportPath = path.join(reportDir, "report.md");

function writeReport(text) {
  fs.appendFileSync(reportPath, text + "\n");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    ...options,
  });

  return {
    command: `${command} ${args.join(" ")}`,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : "",
  };
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return {
      ok: true,
      data: JSON.parse(raw),
      size: raw.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error),
      size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    };
  }
}

function findFiles(dir, predicate, ignoredDirs = new Set([".git", "node_modules", "debug-report"])) {
  const results = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          walk(fullPath);
        }
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function relative(filePath) {
  return path.relative(rootDir, filePath) || ".";
}

function collectKeys(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return collectKeys(value[0]);
  }

  if (value && typeof value === "object") {
    return Object.keys(value).slice(0, 80);
  }

  return [];
}

function countPossibleVideoObjects(value) {
  let count = 0;

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const keys = Object.keys(node);

    const hasLikelyVideoId =
      keys.includes("id") ||
      keys.includes("videoId") ||
      keys.includes("aweme_id") ||
      keys.includes("item_id");

    const hasTikTokShape =
      keys.includes("desc") ||
      keys.includes("createTime") ||
      keys.includes("authorMeta") ||
      keys.includes("videoMeta") ||
      keys.includes("stats") ||
      keys.includes("musicMeta");

    if (hasLikelyVideoId && hasTikTokShape) {
      count++;
    }

    for (const key of keys) {
      walk(node[key]);
    }
  }

  walk(value);
  return count;
}

function extractPossibleIds(value) {
  const ids = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const key of ["id", "videoId", "aweme_id", "item_id"]) {
      if (
        Object.prototype.hasOwnProperty.call(node, key) &&
        typeof node[key] === "string" &&
        /^\d{10,30}$/.test(node[key])
      ) {
        ids.add(node[key]);
      }
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(value);

  return [...ids].slice(0, 20);
}

// Reset report.
fs.writeFileSync(reportPath, "");

writeReport("# TikTok Scraper Debug Report");
writeReport("");
writeReport(`Generated at: ${new Date().toISOString()}`);
writeReport(`Repository root: \`${rootDir}\``);
writeReport(`Username: \`${username}\``);
writeReport(`Number: \`${number}\``);
writeReport("");

writeReport("## Environment");
writeReport("");

const envCommands = [
  ["node", ["--version"]],
  ["npm", ["--version"]],
  ["tiktok-scraper", ["--version"]],
];

for (const [cmd, args] of envCommands) {
  const result = runCommand(cmd, args);
  writeReport(`### \`${result.command}\``);
  writeReport("");
  writeReport(`Exit code: \`${result.status}\``);
  if (result.stdout.trim()) {
if (result.stdout.trim()) {
  writeReport("stdout:");
  writeReport("
```text");
  writeReport(result.stdout.trim());
  writeReport("
```");
}

if (result.stderr.trim()) {
  writeReport("stderr:");
  writeReport("
```text");
  writeReport(result.stderr.trim());
  writeReport("
```");
}

if (result.error) {
  writeReport("error:");
  writeReport("
```text");
  writeReport(result.error);
  writeReport("
```");
}

  }
  writeReport("");
}

writeReport("## Files before scraping");
writeReport("");

const jsonBefore = findFiles(rootDir, (file) => file.endsWith(".json"));
for (const file of jsonBefore) {
  writeReport(`- \`${relative(file)}\``);
}

if (jsonBefore.length === 0) {
  writeReport("No JSON files found before scraping.");
}

writeReport("");

writeReport("## Running scraper");
writeReport("");

const scraperArgs = [
  "user",
  username,
  "--number",
  String(number),
  "--filetype",
  "json",
  "--filepath",
  "./output",
  "--filename",
  `${username}_posts`,
];

const scraperResult = runCommand("tiktok-scraper", scraperArgs);

writeReport(`Command: \`${scraperResult.command}\``);
writeReport(`Exit code: \`${scraperResult.status}\``);
writeReport("");

writeReport("### Scraper stdout");
writeReport("");
writeReport("
```text");
writeReport(scraperResult.stdout.trim() || "[empty]");
writeReport("
```");
writeReport("");

writeReport("### Scraper stderr");
writeReport("");
writeReport("
```text");
writeReport(scraperResult.stderr.trim() || "[empty]");
writeReport("
```");
writeReport("");

if (scraperResult.error) {
  writeReport("### Scraper process error");
  writeReport("");
  writeReport("
```text");
  writeReport(scraperResult.error);
  writeReport("
```");
  writeReport("");
}

fs.writeFileSync(path.join(reportDir, "scraper-stdout.log"), scraperResult.stdout || "");
fs.writeFileSync(path.join(reportDir, "scraper-stderr.log"), scraperResult.stderr || "");

writeReport("## Files after scraping");
writeReport("");

const allFilesAfter = findFiles(rootDir, () => true);
const jsonAfter = allFilesAfter.filter((file) => file.endsWith(".json"));

writeReport(`Total JSON files after scraping: \`${jsonAfter.length}\``);
writeReport("");

for (const file of jsonAfter) {
  const stat = fs.statSync(file);
  writeReport(`- \`${relative(file)}\` — ${stat.size} bytes`);
}

writeReport("");

writeReport("## JSON analysis");
writeReport("");

let likelyTikTokJsonCount = 0;

for (const file of jsonAfter) {
  const parsed = safeReadJson(file);
  const rel = relative(file);

  writeReport(`### \`${rel}\``);
  writeReport("");

  writeReport(`Size: \`${parsed.size}\` bytes`);

  if (!parsed.ok) {
    writeReport(`Parse status: failed`);
    writeReport("");
    writeReport("
```text");
writeReport(parsed.error);
writeReport("
```");
    writeReport("");
    continue;
  }

  const data = parsed.data;
  const topLevelType = Array.isArray(data) ? "array" : typeof data;
  const topLevelLength = Array.isArray(data) ? data.length : null;
  const keys = collectKeys(data);
  const possibleVideoObjects = countPossibleVideoObjects(data);
  const possibleIds = extractPossibleIds(data);

  if (possibleVideoObjects > 0 || possibleIds.length > 0) {
    likelyTikTokJsonCount++;
  }

  writeReport(`Parse status: ok`);
  writeReport(`Top-level type: \`${topLevelType}\``);

  if (topLevelLength !== null) {
    writeReport(`Top-level array length: \`${topLevelLength}\``);
  }

  writeReport(`Possible TikTok video objects: \`${possibleVideoObjects}\``);
  writeReport(`Possible video IDs found: \`${possibleIds.length}\``);

  if (keys.length > 0) {
    writeReport("");
    writeReport("Top-level/sample keys:");
    writeReport("");
    for (const key of keys) {
      writeReport(`- \`${key}\``);
    }
  }

  if (possibleIds.length > 0) {
    writeReport("");
    writeReport("Sample possible video IDs:");
    writeReport("");
    for (const id of possibleIds) {
      writeReport(`- \`${id}\``);
    }
  }

  writeReport("");
}

writeReport("## Summary");
writeReport("");

writeReport(`Scraper exit code: \`${scraperResult.status}\``);
writeReport(`JSON files before scraping: \`${jsonBefore.length}\``);
writeReport(`JSON files after scraping: \`${jsonAfter.length}\``);
writeReport(`Likely TikTok JSON files: \`${likelyTikTokJsonCount}\``);
writeReport("");

if (scraperResult.status !== 0) {
  writeReport("Result: scraper command failed.");
} else if (likelyTikTokJsonCount === 0) {
  writeReport("Result: scraper command completed, but no JSON file looks like TikTok video data.");
} else {
  writeReport("Result: found likely TikTok video data.");
}

console.log(`Debug report written to: ${reportPath}`);
console.log("");
console.log("Summary:");
console.log(`- Scraper exit code: ${scraperResult.status}`);
console.log(`- JSON files before scraping: ${jsonBefore.length}`);
console.log(`- JSON files after scraping: ${jsonAfter.length}`);
console.log(`- Likely TikTok JSON files: ${likelyTikTokJsonCount}`);

// Do not fail the workflow here.
// The point of this script is to collect debugging information.
process.exit(0);
