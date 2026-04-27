const fs = require("fs");
const path = require("path");

const username = process.argv[2];

if (!username) {
  console.error("Missing username argument.");
  process.exit(1);
}

const outputDir = path.join(process.cwd(), "output");

if (!fs.existsSync(outputDir)) {
  console.error(`Output directory does not exist: ${outputDir}`);
  process.exit(1);
}

const files = fs.readdirSync(outputDir);

console.log("Files found in output directory:");
for (const file of files) {
  console.log(`- ${file}`);
}

const jsonFiles = files.filter((file) => file.endsWith(".json"));

if (jsonFiles.length === 0) {
  console.error("No JSON files found in output directory.");
  process.exit(1);
}

/**
 * Prefer a JSON file that contains the username or posts in the name.
 * If none match, use the first JSON file.
 */
const preferredFile =
  jsonFiles.find((file) => file.includes(username) && file.includes("posts")) ||
  jsonFiles.find((file) => file.includes(username)) ||
  jsonFiles.find((file) => file.includes("posts")) ||
  jsonFiles[0];

const inputFile = path.join(outputDir, preferredFile);

console.log(`Using input file: ${inputFile}`);

let data;

try {
  const raw = fs.readFileSync(inputFile, "utf8");
  data = JSON.parse(raw);
} catch (error) {
  console.error(`Failed to read or parse JSON file: ${inputFile}`);
  console.error(error);
  process.exit(1);
}

/**
 * Recursively search for TikTok-like video IDs.
 *
 * Why recursive?
 * Different versions of scrapers often structure output differently.
 * Instead of depending on one exact JSON shape, we walk through the object
 * and collect likely post IDs wherever they appear.
 */
function collectIds(value, ids = []) {
  if (!value) {
    return ids;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIds(item, ids);
    }

    return ids;
  }

  if (typeof value === "object") {
    const possibleIdKeys = [
      "id",
      "videoId",
      "itemId",
      "aweme_id",
      "awemeId",
    ];

    for (const key of possibleIdKeys) {
      const candidate = value[key];

      if (
        typeof candidate === "string" ||
        typeof candidate === "number"
      ) {
        const stringId = String(candidate);

        /**
         * TikTok video IDs are usually long numeric strings.
         * This filter avoids collecting unrelated tiny IDs.
         */
        if (/^\d{10,}$/.test(stringId)) {
          ids.push(stringId);
        }
      }
    }

    for (const nestedValue of Object.values(value)) {
      collectIds(nestedValue, ids);
    }
  }

  return ids;
}

const ids = collectIds(data);

// Remove duplicates while preserving order.
const uniqueIds = [...new Set(ids)];

if (uniqueIds.length === 0) {
  console.error("No video IDs were found in the JSON output.");
  console.error("This may mean the scraper output structure is different, or TikTok returned empty data.");
  process.exit(1);
}

const txtOutput = path.join(outputDir, `${username}_video_ids.txt`);
const jsonOutput = path.join(outputDir, `${username}_video_ids.json`);

fs.writeFileSync(txtOutput, uniqueIds.join("\n") + "\n");
fs.writeFileSync(jsonOutput, JSON.stringify(uniqueIds, null, 2));

console.log(`Extracted ${uniqueIds.length} unique video IDs.`);
console.log(`Wrote: ${txtOutput}`);
console.log(`Wrote: ${jsonOutput}`);
