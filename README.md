# uuaw

> Up, Up And aWay -- Updates deep yarn dependencies to the latest possible versions

## Usage

### Updating Specific Dependencies

```bash
# Updates "node-abi" to the latest possible versions deep
# in your dependency tree
npx uuaw node-abi
```

### Updating Dependencies to fix Yarn Audit

```bash
npx uuaw --audit
```

This does a best-effort attempt at updating the minimal set of transitive / nested
dependencies to fix all issues reported by `yarn audit`.

This command is super experimental and is known to work well for the Green Path
and will stumble quite quickly in the complicated cases.

### Updating Specific Dependencies with a Custom Chain and VersionRange

console.log('npx uuaw --customChain <chain> <neededRange> (--unsafe || ``)');

```bash
npx uuaw --customChain "package>chain>to>dependency" ">=2.0.0" (--unsafe || ``)
```

Requires a valid chain of dependencies and a valid version range. This can be found by running `yarn why <dependency>`. The version range is the version range you want to update to.


Uses the same update logic as --audit, but only updates the specified dependency