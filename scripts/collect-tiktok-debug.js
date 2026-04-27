const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rawUsername = process.argv[2] || 'tiktok';
const rawNumber = process.argv[3] || '30';

const username = String(rawUsername).replace(/^@+/, '').trim() || 'tiktok';
const requestedNumber = String(rawNumber).replace(/[^0-9]/g, '') || '30';

const OUTPUT_DIR = path.resolve('output');
const REPORT_DIR = path.resolve('debug-report');
const REPORT_FILE = path.join(REPORT_DIR, 'report.md');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function text(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function addLine(lines, value) {
  lines.push(text(value));
}

function addBlank(lines) {
  lines.push('');
}

function addCodeBlock(lines, content) {
  lines.push('~~~');
  lines.push(text(content));
  lines.push('~~~');
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 20 * 1024 * 1024
  });

  return {
    command: command,
    args: args,
    status: result.status,
    signal: result.signal,
    error: result.error ? text(result.error.message || result.error) : '',
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function commandToString(command, args) {
  return [command].concat(args).join(' ');
}

function listFilesRecursive(startDir) {
  const results = [];

  if (!fs.existsSync(startDir)) {
    return results;
  }

  function walk(currentDir) {
    let entries = [];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }

        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  walk(startDir);
  return results.sort();
}

function findJsonFiles(startDir) {
  return listFilesRecursive(startDir).filter(function (filePath) {
    return filePath.toLowerCase().endsWith('.json');
  });
}

function extractIds(value, found) {
  if (!found) {
    found = new Set();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractIds(item, found);
    }

    return found;
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const childValue = value[key];
      const lowerKey = key.toLowerCase();

      if (
        lowerKey === 'id' ||
        lowerKey === 'videoid' ||
        lowerKey === 'awemeid' ||
        lowerKey === 'itemid'
      ) {
        if (typeof childValue === 'string' || typeof childValue === 'number') {
          const possibleId = String(childValue);

          if (/^\d{8,}$/.test(possibleId)) {
            found.add(possibleId);
          }
        }
      }

      extractIds(childValue, found);
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
  const info = {
    filePath: filePath,
    size: 0,
    validJson: false,
    parseError: '',
    topLevelType: '',
    topLevelKeys: [],
    ids: [],
    preview: ''
  };

  try {
    const stat = fs.statSync(filePath);
    info.size = stat.size;

    const raw = fs.readFileSync(filePath, 'utf8');
    info.preview = raw.slice(0, 1200);

    const parsed = JSON.parse(raw);

    info.validJson = true;
    info.topLevelType = Array.isArray(parsed) ? 'array' : typeof parsed;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      info.topLevelKeys = Object.keys(parsed).slice(0, 40);
    }

    info.ids = Array.from(extractIds(parsed)).sort();
  } catch (error) {
    info.parseError = text(error && error.message ? error.message : error);
  }

  return info;
}

function writeReport(lines) {
  ensureDir(REPORT_DIR);
  fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n', 'utf8');
}

function addRunResult(lines, title, result) {
  addLine(lines, '## ' + title);
  addBlank(lines);

  addLine(lines, '- Command: `' + commandToString(result.command, result.args) + '`');
  addLine(lines, '- Exit code: `' + text(result.status) + '`');
  addLine(lines, '- Signal: `' + text(result.signal) + '`');
  addLine(lines, '- Error object: `' + text(result.error) + '`');
  addBlank(lines);

  addLine(lines, '### STDOUT');
  addBlank(lines);
  addCodeBlock(lines, result.stdout);
  addBlank(lines);

  addLine(lines, '### STDERR');
  addBlank(lines);
  addCodeBlock(lines, result.stderr);
  addBlank(lines);
}

function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(REPORT_DIR);

  const lines = [];

  addLine(lines, '# TikTok Debug Report');
  addBlank(lines);

  addLine(lines, '- Username: `' + username + '`');
  addLine(lines, '- Requested number: `' + requestedNumber + '`');
  addLine(lines, '- Generated at: `' + new Date().toISOString() + '`');
  addLine(lines, '- Working directory: `' + process.cwd() + '`');
  addBlank(lines);

  const nodeVersion = runCommand('node', ['-v']);
  const npmVersion = runCommand('npm', ['-v']);
  const scraperVersion = runCommand('tiktok-scraper', ['--version']);

  addRunResult(lines, 'Node version', nodeVersion);
  addRunResult(lines, 'NPM version', npmVersion);
  addRunResult(lines, 'TikTok scraper version', scraperVersion);

  addLine(lines, '## Files before scraper run');
  addBlank(lines);

  const beforeFiles = listFilesRecursive('.');
  if (beforeFiles.length === 0) {
    addLine(lines, '- No files found.');
  } else {
    for (const filePath of beforeFiles.slice(0, 250)) {
      addLine(lines, '- `' + filePath + '`');
    }

    if (beforeFiles.length > 250) {
      addLine(lines, '- More files omitted: `' + String(beforeFiles.length - 250) + '`');
    }
  }

  addBlank(lines);

  const firstArgs = ['user', username, '-n', requestedNumber, '-t', 'json', '-d', OUTPUT_DIR];
  const firstRun = runCommand('tiktok-scraper', firstArgs);

  addRunResult(lines, 'Scraper attempt 1', firstRun);

  let finalRun = firstRun;

  if (firstRun.status !== 0) {
    const secondArgs = ['user', '-u', username, '-n', requestedNumber, '-t', 'json', '-d', OUTPUT_DIR];
    const secondRun = runCommand('tiktok-scraper', secondArgs);

    addRunResult(lines, 'Scraper attempt 2', secondRun);

    finalRun = secondRun;
  }

  addLine(lines, '## Files after scraper run');
  addBlank(lines);

  const afterFiles = listFilesRecursive('.');
  if (afterFiles.length === 0) {
    addLine(lines, '- No files found.');
  } else {
    for (const filePath of afterFiles.slice(0, 300)) {
      addLine(lines, '- `' + filePath + '`');
    }

    if (afterFiles.length > 300) {
      addLine(lines, '- More files omitted: `' + String(afterFiles.length - 300) + '`');
    }
  }

  addBlank(lines);

  const jsonFiles = findJsonFiles(OUTPUT_DIR);

  addLine(lines, '## JSON files found in output directory');
  addBlank(lines);

  if (jsonFiles.length === 0) {
    addLine(lines, 'No JSON files were found in the output directory.');
    addBlank(lines);
    addLine(lines, 'This usually means one of these happened:');
    addLine(lines, '- TikTok blocked the GitHub Actions runner.');
    addLine(lines, '- `tiktok-scraper` failed.');
    addLine(lines, '- The scraper wrote files somewhere else.');
    addLine(lines, '- The scraper command syntax is different for the installed version.');
  } else {
    for (const filePath of jsonFiles) {
      let size = 'unknown';

      try {
        size = String(fs.statSync(filePath).size);
      } catch (error) {
        size = 'unknown';
      }

      addLine(lines, '- `' + filePath + '` - `' + size + ' bytes`');
    }
  }

  addBlank(lines);

  addLine(lines, '## JSON analysis');
  addBlank(lines);

  if (json
