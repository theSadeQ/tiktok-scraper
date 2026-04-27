#!/usr/bin/env node

/**
 * collect-tiktok-debug.js
 *
 * Purpose:
 * - Run tiktok-scraper from GitHub Actions.
 * - Record what command was executed.
 * - Find JSON files created anywhere in the repo.
 * - Analyze JSON files to see if they look like TikTok scraper output.
 * - Generate a readable debug report at debug-report/report.md.
 *
 * Usage:
 *   node scripts/collect-tiktok-debug.js username 0
 *
 * Example:
 *   node scripts/collect-tiktok-debug.js tiktok 0
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const username = process.argv[2];
const number = process.argv[3] || "0";

if (!username) {
  console.error("Missing username.");
  console.error("Usage: node scripts/collect-tiktok-debug.js <username> <number>");
  process.exit(1);
}

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const debugDir = path.join(repoRoot, "debug-report");
const reportPath = path.join(debugDir, "report.md");

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(debugDir, { recursive: true });

const reportLines = [];

function writeReport(line = "") {
  reportLines.push(String(line));
}

function saveReport() {
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    ...options,
  });

  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : "",
  };
}

function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function walkFiles(startDir, ignoreDirs = new Set([".git", "node_modules"])) {
  const files = [];

  function walk(currentDir) {
    let entries = [];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) {
          continue;
        }

        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(startDir);
  return files;
}

function findJsonFiles() {
  return walkFiles(repoRoot)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .map((file) => ({
      absolutePath: file,
      relativePath: path.relative(repoRoot, file),
      size: getFileSize(file),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function safeJsonParse(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(content),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: String(error.message || error),
    };
  }
}

/**
 * TikTok scraper outputs can have different shapes depending on version.
 * This helper recursively searches for likely TikTok video IDs.
 */
function collectVideoIds(value, ids = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVideoIds(item, ids);
    }

    return ids;
  }

  if (!value || typeof value !== "object") {
    return ids;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (
      typeof childValue === "string" &&
      /^\d{10,}$/.test(childValue) &&
      [
        "id",
        "videoid",
        "video_id",
        "awemeid",
        "aweme_id",
        "itemid",
        "item_id",
      ].includes(normalizedKey)
    ) {
      ids.add(childValue);
    }

    if (
      typeof childValue === "number" &&
      Number.isFinite(childValue) &&
      String(childValue).length >= 10 &&
      [
        "id",
        "videoid",
        "video_id",
        "awemeid",
        "aweme_id",
        "itemid",
        "item_id",
      ].includes(normalizedKey)
    ) {
      ids.add(String(childValue));
    }

    collectVideoIds(childValue, ids);
  }

  return ids;
}

function countObjects(value) {
  let count = 0;

  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }

      return;
    }

    if (item && typeof item === "object") {
      count += 1;

      for (const child of Object.values(item)) {
        visit(child);
      }
    }
  }

  visit(value);
  return count;
}

function analyzeJsonFile(fileInfo) {
  const parsed = safeJsonParse(fileInfo.absolutePath);

  if (!parsed.ok) {
    return {
      ...fileInfo,
      validJson: false,
      parseError: parsed.error,
      rootType: "unknown",
      possibleVideoIds: [],
      objectCount: 0,
    };
  }

  const root = parsed.value;
  const possibleVideoIds = Array.from(collectVideoIds(root));
  const objectCount = countObjects(root);

  let rootType = typeof root;

  if (Array.isArray(root)) {
    rootType = `array(${root.length})`;
  } else if (root && typeof root === "object") {
    rootType = `object(${Object.keys(root).length} keys)`;
  }

  return {
    ...fileInfo,
    validJson: true,
    parseError: "",
    rootType,
    possibleVideoIds,
    objectCount,
  };
}

function writeCommandResult(title, result) {
  writeReport(`### ${title}`);
  writeReport("");
  writeReport(`Command: \`${result.command} ${result.args.join(" ")}\``);
  writeReport(`Exit code: \`${result.status}\``);

  if (result.signal) {
    writeReport(`Signal: \`${result.signal}\``);
  }

  if (result.error) {
    writeReport("");
    writeReport("Error:");
    writeReport("
```text");
writeReport(result.error);
writeReport("
```");
  }

  if (result.stdout.trim()) {
    writeReport("");
    writeReport("stdout:");
    writeReport("
```text");
writeReport(result.stdout.trim());
writeReport("
```");
  }

  if (result.stderr.trim()) {
    writeReport("");
    writeReport("stderr:");
    writeReport
