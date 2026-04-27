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
  // Ensure line is a string before pushing
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
    } catch (e) {
      console.error(`Error reading directory ${currentDir}: ${e.message}`);
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
  if (value === null || typeof value === "undefined") {
    return ids;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectVideoIds(item, ids);
    }

    return ids;
  }

  if (typeof value !== "object") {
    return ids;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    // Heuristic 1: Check for common ID keys and string values
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
        "id_str", // Added common variations
        "uuid",
      ].includes(normalizedKey)
    ) {
      ids.add(childValue);
    }

    // Heuristic 2: Check for common ID keys and numeric values (convert to string)
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
        "id_str",
        "uuid",
      ].includes(normalizedKey)
    ) {
      ids.add(String(childValue));
    }

    // Recurse into nested objects/arrays
    collectVideoIds(childValue, ids);
  }

  return ids;
}

function countObjects(value) {
  let count = 0;

  function visit(item) {
    if (item === null || typeof item === "undefined") {
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }

    if (typeof item === "object") {
      count += 1; // Count the object itself
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
  writeReport(`\`\`\`bash
${result.command} ${result.args.join(" ")}
\`\`\``);
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
    writeReport("
```text");
writeReport(result.stderr.trim());
writeReport("
```");
  }
}

async function main() {
  writeReport("# TikTok Scraper Debug Report");
  writeReport("");
  writeReport(`Generated on: ${new Date().toISOString()}`);
  writeReport("");

  // 1. Environment and Tool Versions
  writeReport("## Environment and Tool Versions");
  writeReport("");

  const nodeVersion = runCommand("node", ["-v"]);
  writeCommandResult("Node.js Version", nodeVersion);

  const npmVersion = runCommand("npm", ["-v"]);
  writeCommandResult("npm Version", npmVersion);

  const tiktokScraperVersion = runCommand("tiktok-scraper", ["--version"]);
  writeCommandResult("tiktok-scraper Version", tiktokScraperVersion);

  // 2. Files before scraping
  writeReport("");
  writeReport("## Files Before Scraping");
  writeReport("");

  const initialJsonFiles = findJsonFiles();
  if (initialJsonFiles.length > 0) {
    writeReport("Found the following JSON files before scraping:");
    writeReport("
```");
initialJsonFiles.forEach(f => writeReport(`- ${f.relativePath} (${f.size} bytes)`));
writeReport("
```");
  } else {
    writeReport("No JSON files found before scraping.");
  }

  // 3. Run tiktok-scraper command
  writeReport("");
  writeReport("## Running TikTok Scraper");
  writeReport("");

  const scraperArgs = [username];
  if (number !== "0") {
    scraperArgs.push("--number", number);
  }
  scraperArgs.push("--filetype", "json");
  scraperArgs.push("--filepath", "./output"); // Explicitly set to output
  scraperArgs.push("--filename", `${username}_posts`);

  const scraperCommand = "tiktok-scraper";
  const scraperResult = runCommand(scraperCommand, scraperArgs);
  writeCommandResult("tiktok-scraper Execution", scraperResult);

  // 4. Files after scraping
  writeReport("");
  writeReport("## Files After Scraping");
  writeReport("");

  const finalJsonFiles = findJsonFiles();

  if (finalJsonFiles.length > 0) {
    const foundInOutput = finalJsonFiles.filter(f => f.relativePath.startsWith("output/"));
    const foundElsewhere = finalJsonFiles.filter(f => !f.relativePath.startsWith("output/"));

    writeReport(`Found a total of ${finalJsonFiles.length} JSON files after scraping.`);

    if (foundInOutput.length > 0) {
      writeReport(`\n### JSON files found in './output/': ${foundInOutput.length}`);
      writeReport("
```");
foundInOutput.forEach(f => writeReport(`- ${f.relativePath} (${f.size} bytes)`));
writeReport("
```");
    } else {
      writeReport("\nNo JSON files were found in the './output/' directory.");
    }

    if (foundElsewhere.length > 0) {
      writeReport(`\n### JSON files found ELSEWHERE in the repository: ${foundElsewhere.length}`);
      writeReport("
```");
foundElsewhere.forEach(f => writeReport(`- ${f.relativePath} (${f.size} bytes)`));
writeReport("
```");
      writeReport("\n**Note:** The scraper may have written files outside of the expected './output/' directory.");
    }
  } else {
    writeReport("No JSON files found anywhere in the repository after scraping.");
  }

  // 5. Analyze JSON files for video IDs
  writeReport("");
  writeReport("## Analysis of JSON Files");
  writeReport("");

  const analyzedFiles = finalJsonFiles.map(analyzeJsonFile);

  if (analyzedFiles.length === 0) {
    writeReport("No JSON files to analyze.");
  } else {
    let totalPossibleIds = 0;
    let totalObjects = 0;

    analyzedFiles.forEach(fileInfo => {
      writeReport(`### Analysis of: \`${fileInfo.relativePath}\``);
      writeReport("");
      writeReport(`- Valid JSON: ${fileInfo.validJson ? "Yes" : "No"}`);
      if (!fileInfo.validJson) {
        writeReport(`- Parse Error: \`${fileInfo.parseError}\``);
      } else {
        writeReport(`- Root Type: \`${fileInfo.rootType}\``);
        writeReport(`- Object Count: \`${fileInfo.objectCount}\``);
        totalObjects += fileInfo.objectCount;

        if (fileInfo.possibleVideoIds.length > 0) {
          writeReport(`- Possible Video IDs found: ${fileInfo.possibleVideoIds.length}`);
          // Optionally list some IDs if there aren't too many
          if (fileInfo.possibleVideoIds.length <= 5) {
            writeReport("  - IDs: " + fileInfo.possibleVideoIds.join(", "));
          } else {
            writeReport("  - (Too many to list)");
          }
          totalPossibleIds += fileInfo.possibleVideoIds.length;
        } else {
          writeReport("- Possible Video IDs found: 0");
        }
      }
      writeReport("");
    });

    writeReport("---");
    writeReport("### Summary of Analysis");
    writeReport("");
    writeReport(`- Total JSON files analyzed: ${analyzedFiles.length}`);
    writeReport(`- Total objects found across analyzed JSONs: ${totalObjects}`);
    writeReport(`- Total possible TikTok video IDs found: ${totalPossibleIds}`);
  }

  // 6. Final Report Save
  saveReport();
  writeReport(`Debug report saved to: \`${path.relative(repoRoot, reportPath)}\``);
  console.log(`Debug report generated at: ${reportPath}`);
}

main().catch((error) => {
  console.error("An unexpected error occurred during script execution:");
  console.error(error);

  // Attempt to write the error to the report
  writeReport("## Unhandled Script Error");
  writeReport("");
  writeReport("An unexpected error occurred while running the debug script:");
  writeReport("
```text");
  writeReport(String(error.stack || error));
  writeReport("
```");
  saveReport(); // Save report even if there's an error

  process.exitCode = 1; // Indicate failure
});
