# Contributing to CMP

Thanks for your interest in CMP. Here's how to get started.

## Setup

```bash
git clone https://github.com/agentviscro/cmp.git
cd cmp
npm install
```

## Running Tests

```bash
# All tests
npm run test:all

# Specific suites
npm run test              # Core protocol
npm run test:auth         # Authentication
npm run test:consciousness # Layer 11
npm run test:spacetime    # Layer 12
npm run test:wormhole     # Layer 13
npm run test:bridge       # Integration
npm run test:distributed  # Two-node WASM
```

All tests must pass before submitting a PR.

## Project Structure

```
packages/core/src/        Protocol implementation
packages/core/tests/      Test suites
packages/transport/src/   Transport implementations
packages/runtime/src/     WASM sandbox and execution
packages/cli/src/         CLI interface
packages/mobile/          React Native entry point
examples/                 Runnable examples
docs/                     Protocol specifications
```

## Adding a New Feature

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Write tests first
3. Implement the feature
4. Run `npm run test:all` — all tests must pass
5. Submit a PR with a clear description

## Code Style

- TypeScript strict mode
- JSDoc comments on every exported function
- No `any` types in public APIs (internal `any` is acceptable for dynamic imports)
- Test files use `node:test` runner with `describe`/`it` pattern
- Tests end with `after(() => setTimeout(() => process.exit(0), 200))` to prevent hanging

## Areas Where Help is Needed

- **React Native testing** — Run the protocol on real phones via BLE
- **WebGPU integration** — GPU compute from WASM sandboxes
- **ZK-SNARK verification** — Zero-knowledge proofs for computation correctness
- **Production hardening** — Rate limiting, monitoring, graceful version upgrades
- **Real applications** — Build something on CMP and share your experience
- **Documentation** — API reference docs, tutorials, blog posts
- **Benchmarks** — Performance testing across different hardware and network conditions

## Wire Protocol

Adding a new message type? Use the next available code in the appropriate range:

| Range | Layer | Current Max |
|-------|-------|-------------|
| 0x01-0x0F | Discovery/Handshake | 0x04 |
| 0x10-0x1F | Negotiation | 0x13 |
| 0x20-0x2F | Distribution/Assembly | 0x21 |
| 0x30-0x3F | Heartbeat/Departure | 0x31 |
| 0x40-0x5F | Checkpoint/Code | 0x51 |
| 0x60-0x6F | Incentive | 0x60 |
| 0x70-0x7F | MCL | 0x74 |
| 0x80-0x8F | Precognition | 0x84 |
| 0x90-0x9F | Immune | 0x93 |
| 0xA0-0xAF | Futures | 0xA5 |
| 0xB0-0xBF | Morphogenesis | 0xB4 |
| 0xC0-0xDF | Lifeforms | 0xDF |
| 0xE1-0xE5 | Consciousness | 0xE5 |
| 0xE6-0xEB | Spacetime | 0xEB |
| 0xEC-0xF1 | Wormholes | 0xF1 |

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
