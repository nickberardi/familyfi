# Verification records

Each pair of files here is one run of `pnpm spike verify` against a real UniFi console: `<date>-network-<version>.json` is the record, and the `.md` beside it is the same record rendered for reading. [testing.md](../testing.md#what-no-test-proves) links the latest record for each scenario.

A record holds only:

- the date, the console model and UniFi OS version the operator typed, and the UniFi Network version the console reported;
- the FamilyFi version and commit that ran;
- for each scenario, pass, fail, "not observed" or skipped per check, and a redacted one-line reason for a failure;
- whether the run restored the console: nothing left over, and every administrator policy and its order unchanged.

It never holds a UniFi response, a key, a MAC address, an IP address or a policy id. The writer redacts them, and `tests/unit/repository-hygiene.test.ts` fails the build if one reaches this directory anyway.

A run against `UNIFI_MOCK` is not a record: the mock stands in for a gateway and proves nothing about enforcement. The writer refuses to put one here, and the hygiene test refuses one that arrives by hand.

To run one, see [spike/OPERATOR.md](../spike/OPERATOR.md#verification-run). Commit the two files and the updated table in `docs/testing.md` together.
