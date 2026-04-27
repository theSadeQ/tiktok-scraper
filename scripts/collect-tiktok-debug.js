const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const username = process.argv[2] || 'tiktok';
const number = process.argv[3] || '30';

const OUTPUT_DIR = path.resolve('output');
const REPORT_DIR = path.resolve('debug-report');
const REPORT_FILE = path.join(REPORT_DIR, 'report.md');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function shell(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout) : '';
    const stderr = err.stderr ? String(err.stderr) : '';
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }
}

function findJsonFiles(dir) {
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

function extractVideoIds(value, found) {
  if (!found) {
    found = new Set();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractVideoIds(item, found);
    }

    return found;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const v = value[key];
      const lowerKey = key.toLowerCase();

      if (
        (lowerKey === 'id' || lowerKey === 'videoid' || lowerKey === 'awemeid') &&
        (typeof v === 'string' || typeof v === 'number')
      ) {
        const s = String(v);

        if (/^\d{8,}$/.test(s)) {
          found.add(s);
        }
      }

      extractVideoIds(v, found);
    }

    return found;
  }

  if (typeof value === 'string') {
    const matches = value.match(/\b\d{8,}\b/g);

    if (matches) {
      for (const m of matches) {
        found.add(m);
      }
    }
  }

  return found;
}

function analyzeJsonFile(filePath) {
  const info = {
    file: filePath,
    size: 0,
    validJson: false,
    topLevelType: '',
    keys: [],
    videoIds: [],
    parseError: ''
  };

  try {
    const stat = fs.statSync(filePath);
    info.size = stat.size;

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    info.validJson = true;
    info.topLevelType = Array.isArray(parsed) ? 'array' : typeof parsed;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      info.keys = Object.keys(parsed).slice(0, 30);
    }

    info.videoIds = Array.from(extractVideoIds(parsed)).sort();
  } catch (err) {
    info.parseError = err && err.message ? err.message : String(err);
  }

  return info;
}

function writeReport(lines) {
  ensureDir(REPORT_DIR);
  fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n', 'utf8');
}

function addCodeBlock(lines, text) {
  lines.push('~~~');
  lines.push(safeText(text));
  lines.push('~~~');
}

ensureDir(OUTPUT_DIR);
ensureDir(REPORT_DIR);

const lines = [];

lines.push('# TikTok Debug Report');
lines.push('');
lines.push('- Username: ' + username);
lines.push('- Requested count: ' + number);
lines.push('- Generated at: ' + new Date().toISOString());
lines.push('');

lines.push('## Environment');
lines.push('');
lines.push('- Node.js: ' + shell('node -v'));
lines.push('- npm: ' + shell('npm -v'));
lines.push('- tiktok-scraper: ' + shell('tiktok-scraper --version || true'));
lines.push('- Working directory: ' + process.cwd());
lines.push('');

const beforeJson = findJsonFiles(OUTPUT_DIR);

lines.push('## JSON files before scraping');
lines.push('');

if (beforeJson.length === 0) {
  lines.push('- None');
} else {
  for (const file of beforeJson) {
    lines.push('- ' + file);
  }
}

lines.push('');

const commandParts = [
  'tiktok-scraper user',
  '-u "' + username.replace(/"/g, '\\"') + '"',
  '-n ' + String(number).replace(/[^0-9]/g, ''),
  '-t json',
  '-d',
  '"' + OUTPUT_DIR.replace(/"/g, '\\"') + '"'
];

const command = commandParts.join(' ');

lines.push('## Command');
lines.push('');
addCodeBlock(lines, command);
lines.push('');

const result = spawnSync('bash', ['-lc', command], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});

lines.push('## Exit status');
lines.push('');
lines.push('- Exit code: ' + result.status);
lines.push('- Signal: ' + (result.signal || ''));
lines.push('');

lines.push('## STDOUT');
lines.push('');
addCodeBlock(lines, result.stdout || '');
lines.push('');

lines.push('## STDERR');
lines.push('');
addCodeBlock(lines, result.stderr || '');
lines.push('');

const afterJson = findJsonFiles(OUTPUT_DIR);

lines.push('## JSON files after scraping');
lines.push('');

if (afterJson.length === 0) {
  lines.push('- None');
} else {
  for (const file of afterJson) {
    const size = fs.statSync(file).size;
    lines.push('- ' + file + ' (' + size + ' bytes)');
  }
}

lines.push('');

lines.push('## JSON analysis');
lines.push('');

if (afterJson.length === 0) {
  lines.push('No JSON files were produced in the output directory.');
  lines.push('');
  lines.push('Possible reasons:');
  lines.push('- TikTok blocked the GitHub Actions runner IP.');
  lines.push('- tiktok-scraper failed internally.');
  lines.push('- The scraper wrote files somewhere else.');
  lines.push('- The output format or command options are different than expected.');
} else {
  for (const file of afterJson) {
    const analyzed = analyzeJsonFile(file);

    lines.push('### ' + file);
    lines.push('');
    lines.push('- Size: ' + analyzed.size + ' bytes');
    lines.push('- Valid JSON: ' + analyzed.validJson);

    if (analyzed.validJson) {
      lines.push('- Top-level type: ' + analyzed.topLevelType);

      if (analyzed.keys.length > 0) {
        lines.push('- Top-level keys: ' + analyzed.keys.join(', '));
      }

      lines.push('- Video IDs found: ' + analyzed.videoIds.length);

      if (analyzed.videoIds.length > 0) {
        lines.push('');
        lines.push('First video IDs found:');
        lines.push('');

        for (const id of analyzed.videoIds.slice(0, 50)) {
          lines.push('- ' + id);
        }
      }
    } else {
      lines.push('- Parse error: ' + analyzed.parseError);
    }

    lines.push('');
  }
}

lines.push('## Directory tree');
lines.push('');
addCodeBlock(lines, shell('find . -maxdepth 3 -type f | sort'));
lines.push('');

writeReport(lines);

console.log('Debug report written to: ' + REPORT_FILE);

if (afterJson.length === 0) {
  console.error('No JSON files found in output directory after scraping.');
  process.exit(1);
}
`
