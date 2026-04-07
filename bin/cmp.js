#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const cli = path.join(__dirname, '..', 'packages', 'cli', 'src', 'cli.ts');
const args = process.argv.slice(2).join(' ');
try {
  execSync(`npx tsx "${cli}" ${args}`, { stdio: 'inherit', cwd: process.cwd() });
} catch (e) {
  process.exit(e.status || 1);
}
