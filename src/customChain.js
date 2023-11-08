const fs = require('fs');
const path = require('path');

const tackleAdvisory = require('../utils/auditUtils').tackleAdvisory;

if (process.argv.length !== 5 && process.argv.length !== 6) {
  console.log('npx uuaw --customChain <chain> <neededRange> (--unsafe || ``)');
  process.exit(1);
}

const resolution = {
  path: process.argv[3],
};

const advisory = {
  patched_versions: process.argv[4],
  github_advisory_id: 'UNKNOWN_ADVISORY',
  title: 'UNKNOWN_ADVISORY - uuaw custom dependency chain bump',
};

const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
);
let yarnVersion = 'latest';
if (packageJSON && packageJSON.engines && packageJSON.engines.yarn) {
  yarnVersion = packageJSON.engines.yarn;
}
const params = {
  packageJSON,
  yarnVersion,
};

tackleAdvisory(resolution, advisory, params);
