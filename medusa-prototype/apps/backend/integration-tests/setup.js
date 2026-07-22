// Jest `setupFiles` module referenced by jest.config.js. It runs once per test
// file, before the test framework is installed. The previous harness pointed at
// this path but the file did not exist, so every `jest` invocation crashed with
// "Cannot find module './integration-tests/setup.js'" — that is why the
// test:unit / test:integration:* scripts were failing before running a single test.
//
// Clearing MikroORM's global metadata storage before each test file boots the
// Medusa app prevents "entity already defined" errors when several integration
// test files register the same entities in one Jest process (--runInBand). This
// mirrors the canonical Medusa starter setup and is a no-op for pure unit tests.
const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core");

MetadataStorage.clear();
