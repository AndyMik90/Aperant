# Contributing to Auto Claude UI

Thank you for your interest in contributing! This document provides guidelines for contributing to the frontend application.

## Prerequisites

- **Node.js v24.12.0 LTS** - Download from https://nodejs.org
- **npm v10+** - Included with Node.js
- **Git** - For version control

## Getting Started

```bash
# Clone the repository
git clone https://github.com/AndyMik90/Auto-Claude.git
cd Auto-Claude/apps/desktop

# Install dependencies
npm install

# Start development server
npm run dev
```

## Code Style

### Architecture Principles

1. **Feature-based Organization**: Group related code in feature folders
2. **Single Responsibility**: Each file does one thing well
3. **DRY**: Extract common patterns into shared modules
4. **KISS**: Simple solutions over complex ones
5. **SOLID**: Follow object-oriented design principles

### Feature Module Structure

Each feature follows this structure:

```
features/[feature-name]/
├── components/        # Feature-specific React components
├── hooks/             # Feature-specific hooks
├── store/             # Zustand store
└── index.ts           # Public API exports
```

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | `TaskCard.tsx` |
| Hooks | camelCase with `use` | `useTaskStore.ts` |
| Stores | kebab-case | `task-store.ts` |
| Types | PascalCase | `Task.ts` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |

### Import Order

```typescript
// 1. External libraries
import { useState } from 'react';
import { Settings2 } from 'lucide-react';

// 2. Shared components and utilities
import { Button } from '@components/button';
import { cn } from '@lib/utils';

// 3. Feature imports
import { useTaskStore } from '../store/task-store';

// 4. Types (use 'import type')
import type { Task } from '@shared/types';
```

### TypeScript Guidelines

- **No implicit `any`**: Always type parameters and variables
- **Use `type` for objects**: Prefer `type` over `interface`
- **Export types separately**: Use `export type` for type-only exports

```typescript
// Good
type TaskStatus = 'backlog' | 'in_progress' | 'done';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

// Bad
function processTask(data: any) { ... }
```

## Testing

```bash
# Run unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# E2E tests
npm run test:e2e
```

### Coverage Strategy (INV-004 / UNK-004)

The Vitest coverage thresholds in `vitest.config.ts` (`lines: 22, branches: 17, functions: 19, statements: 22`) are **regression floors**, not targets. They were set by commit `d958fa65` (*"harden CI/CD with coverage enforcement"*) as the post-Python-elimination baseline. PRs must not drop coverage below these floors. Raising the floors and adding per-module thresholds for high-risk paths (`ai/security`, `ai/tools`, `ai/agent`, `ipc-handlers`) is tracked by `IDEA-011` / `MS-008` in `.claude/pipeline/roadmap-2026-05-12.md`.

### Writing Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard } from './TaskCard';

describe('TaskCard', () => {
  it('renders task title', () => {
    const task = { id: '1', title: 'Test Task' };
    render(<TaskCard task={task} onClick={vi.fn()} />);

    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });
});
```

## Before Submitting

1. **Run linting**:
   ```bash
   npm run lint:fix
   ```

2. **Check types**:
   ```bash
   npm run typecheck
   ```

3. **Run tests**:
   ```bash
   npm test
   ```

4. **Test the build**:
   ```bash
   npm run build
   ```

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes following the guidelines above
3. Commit with clear messages
4. Push and create a Pull Request
5. Address review feedback

## Security

- Never commit secrets, API keys, or tokens
- Use environment variables for sensitive data
- Validate all IPC data
- Use contextBridge for renderer-main communication

## Questions?

Open an issue or reach out to the maintainers.
