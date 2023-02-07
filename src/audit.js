const lock = require('@yarnpkg/lockfile');
const chalk = require('chalk');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

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

  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const lockFilePath = path.resolve(process.cwd(), 'yarn.lock');
  const lockFile = fs.readFileSync(lockFilePath, 'utf8');
  const result = lock.parse(lockFile);
  if (result.type !== 'success') {
    console.error("Failed to parse lockfile, ensure it isn't in conflict");
    process.exit(1);
  }

  const advisoryToTackle = advisories.pop();

  const { resolution, advisory } = advisoryToTackle.data;

  const chain = resolution.path.split('>');
  const packageName = chain[chain.length - 1];
  const neededRange = advisory.patched_versions;
  const badRange = advisory.vulnerable_versions;

  // Let's resolve the dependency chain from the bad package up to the root package.json
  const lockEntryChain = [];
  let dependencies = {
    ...(packageJSON.dependencies || {}),
    ...(packageJSON.devDependencies || {}),
    ...(packageJSON.optionalDependencies || {}),
    ...(packageJSON.peerDependencies || {}),
  };
  for (const package of chain) {
    const packageRef = `${package}@${dependencies[package]}`;
    const lockEntry = result.object[packageRef];
    if (!lockEntry) {
      console.error(`Failed to trace dependency chain in lockfile for ${package}`);
      process.exit(1);
    }
    dependencies = lockEntry.dependencies;
    lockEntryChain.push({
      package,
      packageRef,
      lockEntry,
    });
  }

  const rootPackage = lockEntryChain[0].package;

  function latestInRange(packageRef) {
    const showResult = cp.spawnSync('npm', ['show', packageRef, '--json'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      maxBuffer: 1024 * 1024 * 20,
    });

    if (showResult.status !== 0) {
      console.error('\nFailed to fetch latest version patching:', packageRef);
      process.exit(showResult.status);
    }

    const info = JSON.parse(showResult.stdout.toString());
    if (Array.isArray(info)) {
      return info[info.length - 1];
    }
    return info;
  }

  if (process.argv.includes('--unsafe')) {
    // As a last resort we try every major version between vCurrent and vLatest
    // This may not be semver-safe but it let's us indicate the minimum required
    // major bump to fix the underlying advisory
    const latest = latestInRange(`${rootPackage}@latest`);
    const currentLatest = latestInRange(lockEntryChain[0].packageRef);
    const currentMajor = semver.parse(currentLatest.version).major;
    const latestMajor = semver.parse(latest.version).major;

    for (let newMajor = currentMajor + 1; newMajor <= latestMajor; newMajor++) {
      lockEntryChain.unshift({
        unsafe: true,
        unsafeNewRange: `^${newMajor}.0.0`,
        package: lockEntryChain[0].package,
        packageRef: `${lockEntryChain[0].package}@^${newMajor}.0.0`,
        lockEntry: lockEntryChain[0].lockEntry,
      });
    }
  }

  // Flip the order of the lock entry chain, we want to start with the deepest dependency and work our way up
  lockEntryChain.reverse();
  const backwardsChain = [...chain].reverse();

  let success = false;
  const advisoryId = advisory.github_advisory_id || advisory.cves?.[0] || 'UNKNOWN_ADVISORY';
  console.log(
    `Attempting to fix advisory:`,
    chalk.bold(chalk.magenta(`${advisoryId} - ${advisory.title}`)),
  );
  console.log('Scanning dependency chain:');
  console.log(
    '    ',
    chain
      .map((package) => chalk.yellow(package))
      .map((package, index) => (index === chain.length - 1 ? chalk.bold(package) : package))
      .join(chalk.grey(' --> ')),
  );
  // For each entry:
  // -- Does bumping it to the latest satisfying version result in a "safe" version of the nested dependency being available
  lockEntryTries: for (const [entryIndex, entry] of lockEntryChain.entries()) {
    const attemptIdent = chalk.magenta(
      `[${entryIndex + 1}/${lockEntryChain.length}]${
        entry.unsafe ? chalk.red(chalk.bold(' [UNSAFE]')) : ''
      }`,
    );
    console.log(attemptIdent, 'Trying from:', chalk.cyan(entry.packageRef));
    const chainToResolve = backwardsChain.slice(0, entryIndex + 1).reverse();
    let newLatest = null;
    let packageRef = entry.packageRef;
    for (const [packageIndex] of chainToResolve.entries()) {
      process.stdout.write(`    Resolving: ${chalk.cyan(packageRef)}`);
      newLatest = latestInRange(packageRef);
      process.stdout.write(`${chalk.grey(' --> ')}${chalk.yellow(newLatest.version)}\n`);
      const deps = {
        ...(newLatest.dependencies || {}),
        ...(newLatest.devDependencies || {}),
        ...(newLatest.optionalDependencies || {}),
        ...(newLatest.peerDependencies || {}),
      };
      const package = chainToResolve[packageIndex + 1];
      if (package) {
        if (deps[package]) {
          packageRef = `${package}@${deps[package]}`;
        } else {
          packageRef = null;
          break;
        }
      }
    }
    if (newLatest || !packageRef) {
      if (!packageRef || semver.satisfies(newLatest.version, neededRange)) {
        if (packageRef) {
          console.log(
            attemptIdent,
            'Updating chain to latest starting at:',
            chalk.green(entry.packageRef),
            'results in a patched version:',
            chalk.green(`${newLatest.name}@${newLatest.version}`),
          );
        } else {
          console.log(
            attemptIdent,
            'Updating chain to latest starting at:',
            chalk.green(entry.packageRef),
            `results in ${chalk.bold('cutting')} the known chain`,
          );
        }
        if (entry.unsafe) {
          console.warn(
            attemptIdent,
            chalk.yellow(
              `Updating top level dependency ${entry.package} to range ${
                entry.packageRef
              } is ${chalk.bold('not')} a semver-safe operation but it does fix this advisory`,
            ),
          );

          for (const depKey of [
            'dependencies',
            'devDependencies',
            'optionalDependencies',
            'peerDependencies',
          ]) {
            const deps = packageJSON[depKey] || {};

            for (const dep of Object.keys(deps)) {
              if (dep === entry.package) {
                deps[dep] = entry.unsafeNewRange;
              }
            }
          }

          fs.writeFileSync(packageJsonPath, JSON.stringify(packageJSON, null, 2));
        } else {
          const refsToFreshResolve = lockEntryChain
            .slice(0, entryIndex + 1)
            .map((p) => p.packageRef);
          for (const refToFreshResolve of refsToFreshResolve) {
            delete result.object[refToFreshResolve];
          }

          fs.writeFileSync(lockFilePath, lock.stringify(result.object));
        }

        console.log(attemptIdent, `Running ${chalk.blue('yarn install')} now\n`);

        // Run with --ignore-scripts for speed
        const r = cp.spawnSync('npx', [`yarn@${yarnVersion}`, '--ignore-scripts'], {
          cwd: process.cwd(),
          stdio: 'ignore',
        });
        if (r.status !== 0) {
          console.error(attemptIdent, chalk.red('Failed to yarn install'));
          process.exit(r.status);
        }
        success = true;
        break lockEntryTries;
      }
      console.log(
        attemptIdent,
        `Chain results in vulnerable version: ${newLatest.name}@${newLatest.version}`,
      );
    }
  }

  if (!success) {
    console.error(
      chalk.red('No update chain could be found to get', packageName, 'into', neededRange),
    );
    process.exit(1);
  }
}
