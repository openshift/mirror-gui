Contributing to `mirror-gui`
====

- [Contributing to `mirror-gui`](#contributing-to-mirror-gui)
  - [What should I know before I get started?](#what-should-i-know-before-i-get-started)
  - [How can I contribute?](#how-can-i-contribute)
    - [Reporting Bugs](#reporting-bugs)
    - [Requesting Enhancements](#requesting-enhancements)
    - [Your First Code Contribution](#your-first-code-contribution)
      - [Getting Started](#getting-started)
    - [Pull Requests](#pull-requests)
    - [Docs Contributions](#docs-contributions)
  - [Testing](#testing)

Welcome to our contributing guide! We are eager to receive contributions of all types.

## What should I know before I get started?

Mirror-GUI is a web-based interface for oc-mirror v2 that helps users manage OpenShift Container Platform mirroring operations. It is a TypeScript application with a React frontend (PatternFly 6) and an Express backend.

Before contributing, familiarize yourself with:
- The [README](README.md) for project overview and setup
- The [ARCHITECTURE](ARCHITECTURE.md) for how the application is structured
- The [API documentation](API.md) for the REST API surface
- The [TESTS](TESTS.md) documentation for the test suite

## How can I contribute?

### Reporting Bugs

Please submit bug reports as GitHub Issues. When submitting bug reports, please include:
1. A concise title
2. Steps to reproduce the issue
3. Browser and environment details (container runtime, architecture)
4. Screenshots if the issue is visual
5. Relevant server logs (available via `./local-build.sh --logs`)

### Requesting Enhancements

Please submit enhancement requests as GitHub Issues. When requesting enhancements, please include:

1. A concise title
2. A concise description of the modification
3. The conditions under which the modification would be relevant
4. The desired outcome of the modification
5. Provide step-by-step instructions of the enhancement
6. Explain the difference between enhancement and current functionality
7. Explain enhancement use cases

### Your First Code Contribution

#### Getting Started

1. Fork the repository and clone it locally
2. Install dependencies: `npm ci`
3. Start the development server: `npm run dev`
4. Run tests to verify your setup: `npm test`

The development server runs the Express backend with Vite middleware for hot-reloading the React frontend. The server listens on port 3001 by default in development mode.

### Pull Requests

When submitting pull requests, please ensure the following:
1. Include unit tests or integration tests for backend changes
2. Include E2E tests for new UI features or workflows
3. Run `npm run lint` and fix any issues
4. Run `npm test` to ensure all tests pass
5. Update documentation (API.md, TESTS.md, etc.) if applicable
6. Follow existing code patterns and PatternFly conventions for UI components

### Docs Contributions

We will always need better docs! You can contribute to our documentation in the following ways:

1. Improved setup and usage guides
2. Enhanced API documentation in [API.md](API.md)
3. Tutorials for specific mirroring scenarios
4. Architecture and design documentation

## Testing

Mirror-GUI has a comprehensive test suite covering unit, integration, and end-to-end tests. See [TESTS.md](TESTS.md) for full details.

To run tests locally:

```bash
npm test              # unit and integration tests (Vitest)
npm run test:coverage # tests with coverage report
npm run test:e2e      # end-to-end tests (Playwright, headless Chromium)
npm run test:all      # all tests
npm run lint          # ESLint
```

CI runs automatically on pull requests via GitHub Actions with three parallel jobs: unit/integration tests, E2E tests, and shellcheck. The container image is built in the Cachi2 pipeline, not in GitHub Actions.
