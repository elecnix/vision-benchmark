#!/usr/bin/env node
/** Deploy docs/ to gh-pages branch */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = process.cwd();
const tmpDir = '/tmp/gh-deploy';

// Read docs content
const docsPath = path.join(repoDir, 'docs');
if (!fs.existsSync(docsPath)) {
  console.error('No docs/ directory found. Run generate-report.ts first.');
  process.exit(1);
}

// Clone gh-pages to tmp if needed
if (!fs.existsSync(tmpDir)) {
  execSync(`git clone --branch gh-pages $(git remote get-url origin) ${tmpDir}`, { stdio: 'inherit' });
}

// Clear and copy fresh
const targetDocs = path.join(tmpDir, 'docs');
fs.rmSync(targetDocs, { recursive: true, force: true });
fs.mkdirSync(targetDocs, { recursive: true });
for (const f of fs.readdirSync(docsPath)) {
  fs.copyFileSync(path.join(docsPath, f), path.join(targetDocs, f));
}

// Commit and push
process.chdir(tmpDir);
execSync('git add docs/', { stdio: 'pipe' });
try {
  execSync('git commit -m "deploy: ' + new Date().toISOString().slice(0,10) + '"', { stdio: 'inherit' });
} catch(e) {
  console.log('No changes to commit');
}
execSync('git push origin gh-pages', { stdio: 'inherit' });
console.log('Deployed to gh-pages!');
