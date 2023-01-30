#!/usr/bin/env node

const lock = require('@yarnpkg/lockfile');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const packageToUpdate = process.argv[2];
if (packageToUpdate === '--audit') {
  require('./audit');
  process.exit(0);
}

const lockFilePath = path.resolve(process.cwd(), 'yarn.lock');
const lockFile = fs.readFileSync(lockFilePath, 'utf8');
if (!packageToUpdate) {
  console.error('Usage: uuaw [package]');
  process.exit(1);
}

const result = lock.parse(lockFile);
if (result.type !== 'success') {
  console.error("Failed to parse lockfile, ensure it isn't in conflict");
  process.exit(1);
}

const deps = result.object;
for (const key of Object.keys(deps)) {
  if (key.startsWith(`${packageToUpdate}@`)) {
    delete deps[key];
  }
}

fs.writeFileSync(lockFilePath, lock.stringify(deps));

const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
);
let yarnVersion = 'latest';
if (packageJSON && packageJSON.engines && packageJSON.engines.yarn) {
  yarnVersion = packageJSON.engines.yarn;
}

const r = cp.spawnSync('npx', [`yarn@${yarnVersion}`], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
if (r.status !== 0) {
  process.exit(r.status);
}
