const fs = require("fs");
const path = require("path");

const username = process.argv[2];

if (!username) {
  console.error("Missing username argument.");
  process.exit(1);
}

const outputDir = path.join(process.cwd(), "output");
const inputFile = path.join(outputDir, `${username}_posts.json`);

if (!fs.existsSync(inputFile)) {
  console.error(`Could not find scraper output file: ${inputFile}`);
  console.error("Files in output directory:");

  if (fs.existsSync(outputDir)) {
    console.error(fs.readdirSync(outputDir).join("\n"));
  }

  process.exit(1);
}

const raw = fs.readFileSync(inputFile, "utf8");
const data = JSON.parse(raw);

/**
 * The scraper output shape can vary by version.
 * This function tries common locations where post arrays may exist.
 */
function findPosts(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const possibleKeys = [
    "collector",
    "posts",
    "items",
    "data",
    "videos",
  ];

  for (const key of possibleKeys) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }

  return [];
}

/**
 * TikTok metadata fields can also vary by scraper version.
 * We try several likely ID fields.
 */
function getVideoId(post) {
  if (!post || typeof post !== "object") {
    return null;
  }

  return (
    post.id ||
    post.videoId ||
    post.itemId ||
    post.aweme_id ||
    post.awemeId ||
    null
  );
}

const posts = findPosts(data);

const ids = posts
  .map(getVideoId)
  .filter(Boolean)
  .map(String);

// Remove duplicates while preserving order.
const uniqueIds = [...new Set(ids)];

const txtOutput = path.join(outputDir, `${username}_video_ids.txt`);
const jsonOutput = path.join(outputDir, `${username}_video_ids.json`);

fs.writeFileSync(txtOutput, uniqueIds.join("\n") + "\n");
fs.writeFileSync(jsonOutput, JSON.stringify(uniqueIds, null, 2));

console.log(`Found ${posts.length} posts.`);
console.log(`Extracted ${uniqueIds.length} unique video IDs.`);
console.log(`Wrote: ${txtOutput}`);
console.log(`Wrote: ${jsonOutput}`);
