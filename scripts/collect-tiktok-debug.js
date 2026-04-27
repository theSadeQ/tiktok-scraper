const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const username = process.argv[2] || 'tiktok';
const requestedNumberRaw = process.argv[3] || '30';
const requestedNumber = String(requestedNumberRaw).replace(/[^0-9]/g, '') || '30';

const OUTPUT_DIR = path.resolve('output');
const REPORT_DIR = path.resolve('debug-report');
const REPORT_FILE = path.join(REPORT_DIR, 'report.md');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function safeCommandArg(value) {
  return String(value).replace(/"/g, '\\"');
}

function runCommandCapture(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const stdout = error && error.stdout ? String(error.stdout) : '';
    const stderr = error && error.stderr ? String(error.stderr) : '';
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }
}

function listFilesRecursive(dirPath) {
  const results = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results.sort();
}

function findJsonFiles(dirPath) {
  return listFilesRecursive(dirPath).filter((filePath) =>
    filePath.toLowerCase().endsWith('.json')
  );
}

function extractNumericIdsDeep(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      extractNumericIdsDeep(item, found);
    }
    return found;
  }

  if (value && typeof value === 'object') {
    for (const [key, childValue] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();

      if (
        (lowerKey === 'id' ||
          lowerKey === 'videoid' ||
          lowerKey === 'awemeid' ||
          lowerKey === 'itemid') &&
        (typeof childValue === 'string' || typeof childValue === 'number')
      ) {
        const candidate = String(childValue);
        if (/^\d{8,}$/.test(candidate)) {
          found.add(candidate);
        }
      }

      extractNumericIdsDeep(childValue, found);
    }

    return found;
  }

  if (typeof value === 'string') {
    const matches = value.match(/\b\d{8,}\b/g);
    if (matches) {
      for (const match of matches) {
        found.add(match);
      }
    }
  }

  return found;
}

function analyzeJsonFile(filePath) {
  const analysis = {
    filePath,
    size: 0,
    validJson: false,
    topLevelType: '',
    topLevelKeys: [],
    videoIds: [],
    parseError: '',
    preview: ''
  };

  try {
    const stat = fs.statSync(filePath);
    analysis.size = stat.size;

    const raw = fs.readFileSync(filePath, 'utf8');
    analysis.preview = raw.slice(0, 1000);

    const parsed = JSON.parse(raw);

    analysis.validJson = true;
    analysis.topLevelType = Array.isArray(parsed) ? 'array' : typeof parsed;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      analysis.topLevelKeys = Object.keys(parsed).slice(0, 50);
    }

    analysis.videoIds = Array.from(extractNumericIdsDeep(parsed)).sort();
  } catch (error) {
    analysis.parseError = error && error.message ? error.message : String(error);
  }

  return analysis;
}

function addCodeBlock(lines, content) {
  lines.push('~~~');
  lines.push(toText(content));
  lines.push('~~~');
}

function writeReport(lines) {
  ensureDir(REPORT_DIR);
  fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n', 'utf8');
}

function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(REPORT_DIR);

  const lines = [];

  lines.push('# TikTok Debug Report');
  lines.push('');
  lines.push('- Username: ' + username);
  lines.push('- Requested count: ' + requestedNumber);
  lines.push('- Generated at: ' + new Date().toISOString());
  lines.push('');

  lines.push('## Environment');
  lines.push('');
  lines.push('- Node.js: ' + runCommandCapture('node -v'));
  lines.push('- npm: ' + runCommandCapture('npm -v'));
  lines.push('- tiktok-scraper: ' + runCommandCapture('tiktok-scraper --version || true'));
  lines.push('- Working directory: ' + process.cwd());
  lines.push('');

  const filesBefore = listFilesRecursive('.');
  const jsonBefore = findJsonFiles(OUTPUT_DIR);

  lines.push('## Files before scraping');
  lines.push('');
  if (filesBefore.length === 0) {
    lines.push('- None');
  } else {
    for (const filePath of filesBefore.slice(0, 200)) {
      lines.push('- ' + filePath);
    }
    if (filesBefore.length > 200) {
      lines.push('- ... (' + (filesBefore.length - 200) + ' more files)');
    }
  }
  lines.push('');

  lines.push('## JSON files before scraping');
  lines.push('');
  if (jsonBefore.length === 0) {
    lines.push('- None');
  } else {
    for (const filePath of jsonBefore) {
      lines.push('- ' + filePath);
    }
  }
  lines.push('');

  const scraperCommand = [
    'tiktok-scraper user',
    '-u "' + safeCommandArg(username) + '"',
    '-n ' + requestedNumber,
    '-t json',
    '-d "' + safeCommandArg(OUTPUT_DIR) + '"'
  ].join(' ');

  lines.push('## Scraper command');
  lines.push('');
  addCodeBlock(lines, scraperCommand);
  lines.push('');

  const result = spawnSync('bash', ['-lc', scraperCommand], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  lines.push('## Scraper result');
  lines.push('');
  lines.push('- Exit code: ' + String(result.status));
  lines.push('- Signal: ' + toText(result.signal));
  lines.push('- Error object: ' + (result.error ? toText(result.error.message || result.error) : ''));
  lines.push('');

  lines.push('## STDOUT');
  lines.push('');
  addCodeBlock(lines, result.stdout || '');
  lines.push('');

  lines.push('## STDERR');
  lines.push('');
  addCodeBlock(lines, result.stderr || '');
  lines.push('');

  const filesAfter = listFilesRecursive('.');
  const jsonAfter = findJsonFiles(OUTPUT_DIR);

  lines.push('## Files after scraping');
  lines.push('');
  if (filesAfter.length === 0) {
    lines.push('- None');
  } else {
    for (const filePath of filesAfter.slice(0, 300)) {
      lines.push('- ' + filePath);
    }
    if (filesAfter.length > 300) {
      lines.push('- ... (' + (filesAfter.length - 300) + ' more files)');
    }
  }
  lines.push('');

  lines.push('## JSON files after scraping');
  lines.push('');
  if (jsonAfter.length === 0) {
    lines.push('- None');
  } else {
    for (const filePath of jsonAfter) {
      let sizeText = '';
      try {
        const stat = fs.statSync(filePath);
        sizeText = ' (' + stat.size + ' bytes)';
      } catch (error) {
        sizeText = ' (size unavailable)';
      }
      lines.push('- ' + filePath + sizeText);
    }
  }
  lines.push('');

  lines.push('## JSON analysis');
  lines.push('');
  if (jsonAfter.length === 0) {
    lines.push('No JSON files were created in the output directory.');
    lines.push('');
    lines.push('Possible reasons:');
    lines.push('- TikTok blocked the request from the GitHub Actions runner.');
    lines.push('- tiktok-scraper failed internally.');
    lines.push('- The tool wrote output somewhere unexpected.');
    lines.push('- The command-line options are not behaving as expected in this environment.');
    lines.push('');
  } else {
    for (const filePath of jsonAfter) {
      const analysis = analyzeJsonFile(filePath);

      lines.push('### ' + filePath);
      lines.push('');
      lines.push('- Size: ' + analysis.size + ' bytes');
      lines.push('- Valid JSON: ' + String(analysis.validJson));

      if (analysis.validJson) {
        lines.push('- Top-level type: ' + analysis.topLevelType);

        if (analysis.topLevelKeys.length > 0) {
          lines.push('- Top-level keys: ' + analysis.topLevelKeys.join(', '));
        } else {
          lines.push('- Top-level keys: none');
        }

        lines.push('- Video IDs found: ' + analysis.videoIds.length);

        if (analysis.videoIds.length > 0) {
          lines.push('');
          lines.push('First detected IDs:');
          lines.push('');
          for (const id of analysis.videoIds.slice(0, 50)) {
            lines.push('- ' + id);
          }
        }
      } else {
        lines.push('- Parse error: ' + analysis.parseError);
        lines.push('');
        lines.push('Preview:');
        lines.push('');
        addCodeBlock(lines, analysis.preview);
      }

      lines.push('');
    }
  }

  lines.push('## Directory tree snapshot');
  lines.push('');
  addCodeBlock(lines, runCommandCapture('find . -maxdepth 4 -type f | sort'));
  lines.push('');

  writeReport(lines);

  console.log('Debug report written to: ' + REPORT_FILE);

  if (jsonAfter.length === 0) {
    console.error('No JSON files found in output directory after scraping.');
    process.exit(1);
  }
}

main();
