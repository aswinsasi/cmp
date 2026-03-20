# Contributing to CMP

Thank you for your interest in the Compute Mesh Protocol. CMP is an open protocol — contributions from everyone are welcome.

## Ways to Contribute

- **Bug reports** — Found something broken? Open an issue.
- **Code contributions** — Fix bugs, add features, improve tests.
- **Protocol feedback** — Review the [spec](./spec/CMP-v1.0.md) and suggest improvements.
- **Documentation** — Improve docs, add examples, fix typos.
- **Transport implementations** — Build CMP for new transports (Bluetooth Classic, NFC, ultrasonic).
- **Platform ports** — Port the SDK to Rust, Go, Swift, Kotlin.
- **CEPs** — Propose protocol changes via CMP Enhancement Proposals.

## Development Setup

```bash
git clone https://github.com/agentviscro/cmp.git
cd cmp

# Install all packages
cd packages/core && npm install
cd ../runtime && npm install
cd ../cli && npm install
cd ../core

# Run tests
npx tsx tests/phase1.test.ts
npx tsx tests/phase2.test.ts
npx tsx tests/phase3.test.ts
npx tsx tests/phase4.test.ts
npx tsx tests/phase5.test.ts
```

## Code Style

- TypeScript with strict mode
- Every public function has a JSDoc comment
- Every new feature has tests
- No external dependencies without discussion

## Pull Request Process

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Write code + tests
4. Run all tests: ensure 150+ tests pass
5. Submit PR with a clear description of what and why

## CMP Enhancement Proposals (CEP)

Protocol changes go through the CEP process:

1. Open an issue titled `CEP: [Your Proposal Title]`
2. Describe the problem, proposed solution, and trade-offs
3. Community discussion (minimum 1 week)
4. If consensus reached, implement and submit PR
5. Spec is updated with the accepted change

## Code of Conduct

Be respectful. Be constructive. Build things that matter.

## License

By contributing, you agree that your contributions will be licensed under MIT.
