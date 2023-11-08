const chalk = require('chalk');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const { tackleAdvisory } = require('../utils/auditUtils');

while (true) {
  const packageJSON = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  );
  let yarnVersion = 'latest';
  if (packageJSON && packageJSON.engines && packageJSON.engines.yarn) {
    yarnVersion = packageJSON.engines.yarn;
  }

  const r = cp.spawnSync('npx', [`yarn@${yarnVersion}`, 'audit', '--json', '--no-progress'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 20,
  });

  const rawAudit = r.stdout.toString();
  const auditEntries = rawAudit
    .split(/\n/g)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const advisories = auditEntries.filter((entry) => entry.type === 'auditAdvisory');
  if (advisories.length === 0) {
    console.log(chalk.green(chalk.bold("Audit is clean, looking good cap'n")));
    process.exit(0);
  }

  const advisoryToTackle = advisories.pop();

  const { resolution, advisory } = advisoryToTackle.data;
  const params = {
    packageJSON,
    yarnVersion,
  };
  tackleAdvisory(resolution, advisory, params);
}
