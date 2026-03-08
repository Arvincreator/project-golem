# Contributing to Project Golem

Thank you for your interest in contributing to Project Golem! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

## Code of Conduct

Be respectful, constructive, and collaborative. We welcome contributors of all experience levels.

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Docker** (optional, for containerized deployment)
- **Google Gemini API Key** (free tier available at [aistudio.google.com](https://aistudio.google.com))

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Arvincreator/project-golem.git
cd project-golem

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Run in API mode (no browser required)
node index.js --api-brain

# Run with browser (requires Chromium)
node index.js
```

### Docker Setup

```bash
docker build -t project-golem .
docker run -e GEMINI_API_KEY=your-key project-golem
```

## Development Setup

```bash
# Install all dependencies including devDependencies
npm install

# Run tests
npx jest --verbose

# Run specific test file
npx jest test/EventBus.test.js --verbose

# Run with doctor mode (diagnostics)
node index.js --doctor
```

## Architecture Overview

```
project-golem/
├── index.js                    # Entry point
├── src/
│   ├── core/                   # Brain, Page Interaction, Multi-Agent
│   │   ├── GolemBrain.js       # Gemini AI brain (Puppeteer-based)
│   │   ├── ApiBrain.js         # API-only brain (no Chromium)
│   │   ├── PageInteractor.js   # DOM interaction engine
│   │   ├── InteractiveMultiAgent.js  # Multi-agent orchestration
│   │   └── action_handlers/    # Action routing (Android, etc.)
│   ├── managers/               # Subsystem managers
│   │   ├── SkillManager.js     # Skill loading & hot-reload
│   │   ├── SecurityManager.js  # Input validation & security
│   │   └── DashboardManager.js # Dashboard data provider
│   ├── memory/                 # Memory drivers
│   │   ├── BrowserMemoryDriver.js  # IndexedDB via Puppeteer
│   │   ├── SystemNativeDriver.js   # File-based (.md)
│   │   └── SystemQmdDriver.js      # QMD format
│   ├── services/               # Utility services
│   │   ├── ProtocolFormatter.js    # Titan Protocol formatting
│   │   └── Introspection.js        # Self-analysis
│   ├── utils/                  # Shared utilities
│   │   ├── EventBus.js         # Pub/sub event system
│   │   ├── CircuitBreaker.js   # Circuit breaker pattern
│   │   ├── RetryHelper.js      # Exponential backoff retry
│   │   ├── RateLimiter.js      # Token bucket rate limiting
│   │   ├── TaskQueue.js        # Priority async task queue
│   │   └── ProcessManager.js   # Crash recovery & auto-restart
│   └── skills/                 # Skill definitions (.md + .js)
├── web-dashboard/              # Next.js dashboard
│   └── src/
│       ├── app/                # Pages (dashboard, office, agents)
│       └── components/         # React components
├── test/                       # Jest test files
├── docker-compose.yml          # Docker Compose config
├── render.yaml                 # Render.com Blueprint
└── fly.toml                    # Fly.io config
```

### Key Concepts

1. **GolemBrain** — The AI core that connects to Google Gemini via Puppeteer (browser mode) or API (api-brain mode).

2. **Titan Protocol** — The structured response format Golem uses internally. Responses contain blocks like `[GOLEM_ACTION]`, `[GOLEM_MEMORY]`, `[GOLEM_REPLY]`.

3. **Skills** — Modular capabilities defined as markdown files in `src/skills/`. Skills can be loaded, reloaded, and shared.

4. **Memory Drivers** — Pluggable storage backends for Golem's memory. Currently supports browser IndexedDB, native files, and QMD format.

5. **EventBus** — Decoupled pub/sub system for inter-component communication.

## Making Changes

### Branch Naming

```
feat/feature-name       # New features
fix/bug-description     # Bug fixes
docs/what-changed       # Documentation
test/what-tested        # Tests only
refactor/what-changed   # Code refactoring
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add rate limiter for API endpoints
fix: handle null response in PageInteractor
docs: add architecture overview
test: add CircuitBreaker unit tests
refactor: extract retry logic into RetryHelper
```

## Testing

We use **Jest** for testing. All new features should include tests.

```bash
# Run all tests
npx jest --verbose

# Run with coverage
npx jest --coverage

# Run specific test
npx jest test/EventBus.test.js

# Watch mode (re-run on changes)
npx jest --watch
```

### Test File Naming

- Test files go in `test/` directory
- Name them `{ModuleName}.test.js`
- Example: `src/utils/EventBus.js` → `test/EventBus.test.js`

### Writing Tests

```javascript
const { MyModule } = require('../src/utils/MyModule');

describe('MyModule', () => {
    let instance;

    beforeEach(() => {
        instance = new MyModule();
    });

    afterEach(() => {
        instance.destroy();  // Clean up resources
    });

    test('does the thing', () => {
        expect(instance.doThing()).toBe(true);
    });
});
```

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch from `main`
3. **Implement** your changes with tests
4. **Test** locally: `npx jest --verbose`
5. **Commit** with conventional commit messages
6. **Push** to your fork
7. **Open a PR** against `Arvincreator/project-golem:main`

### PR Checklist

- [ ] Tests pass locally
- [ ] New features include unit tests
- [ ] Code follows existing style
- [ ] Commit messages follow convention
- [ ] PR description explains the "why"

## Coding Standards

### JavaScript

- Use `'use strict'` in all Node.js files
- Use `??` (nullish coalescing) instead of `||` for defaults that could be `0` or `false`
- Document public methods with JSDoc
- Handle errors explicitly — never swallow errors silently
- Use async/await over raw Promises where possible

### React/TypeScript (Dashboard)

- Use functional components with hooks
- Add `"use client"` directive for client components
- Use Tailwind CSS for styling
- Add ARIA labels for accessibility
- Wrap pages in ErrorBoundary

### General

- Keep files under 300 lines when possible
- One class/module per file
- Export both class and singleton when applicable
- Include cleanup methods (destroy, dispose, close)

## Need Help?

- Open an [issue](https://github.com/Arvincreator/project-golem/issues) for bugs or feature requests
- Check existing issues and PRs before creating new ones
- Tag your issues with appropriate labels

---

Happy contributing! 🤖
