# Development Workflow Guide

This guide helps you develop features efficiently for **both frontend and backend** while catching errors early. Follow these practices to avoid waiting until feature completion to discover TypeScript, Python, or test errors.

## Table of Contents
- [IDE Setup](#ide-setup)
- [Frontend Development](#frontend-development)
- [Backend Development](#backend-development)
- [Testing Strategy](#testing-strategy)
- [Full-Stack Features](#full-stack-features)
- [TypeScript Best Practices](#typescript-best-practices)
- [Python Best Practices](#python-best-practices)
- [Common Pitfalls](#common-pitfalls)
- [Pre-Commit Checklist](#pre-commit-checklist)

---

## IDE Setup

### Required Extensions (VS Code)

#### For Frontend (TypeScript/React)

1. **TypeScript Language Server** (built-in)
   - Provides inline TypeScript errors
   - Shows errors as you type

2. **ESLint**
   - Catches code quality issues
   - Auto-fixes on save

3. **Vitest** (optional)
   - Run tests in watch mode
   - See test results inline

#### For Backend (Python)

1. **Python** (Microsoft)
   - IntelliSense, linting, debugging
   - Type checking with Pylance

2. **Ruff** (Astral Software)
   - Fast Python linter and formatter
   - Replaces black, isort, flake8

3. **Python Test Explorer**
   - Run pytest tests from UI
   - See test results inline

### Recommended Settings

Add to `.vscode/settings.json`:

```json
{
  // TypeScript
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  
  // Python
  "python.defaultInterpreterPath": "${workspaceFolder}/apps/backend/.venv/bin/python",
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "python.formatting.provider": "none",
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports": true
    }
  },
  
  // Testing
  "python.testing.pytestEnabled": true,
  "python.testing.unittestEnabled": false,
  "python.testing.pytestArgs": [
    "tests"
  ]
}
```

---

## Frontend Development

### 1. During Development

#### Run TypeScript in Watch Mode

Open a terminal and run:

```bash
cd apps/frontend
npm run typecheck -- --watch
```

This gives you **real-time TypeScript feedback** as you code.

#### Run Unit Tests in Watch Mode

Open another terminal and run:

```bash
cd apps/frontend
npm test -- --watch
```

This runs tests automatically when files change.

### 2. E2E Testing (Electron App)

For frontend features that involve UI interactions, write E2E tests using the Electron MCP integration:

#### When to Write E2E Tests

- **New UI features** - Forms, buttons, navigation
- **User workflows** - Multi-step processes
- **Visual changes** - Layout, styling, components
- **Integration points** - IPC communication, settings persistence

#### Running E2E Tests

```bash
# 1. Start the Electron app in dev mode
npm run dev  # Runs with --remote-debugging-port=9222

# 2. In another terminal, enable Electron MCP
cd apps/backend
# Add to .env: ELECTRON_MCP_ENABLED=true

# 3. Run QA agent with E2E testing enabled
python run.py --spec 001 --qa
```

#### E2E Test Example

See the navigation mode feature tests for examples:
- Tests verify UI renders correctly
- Tests interact with buttons/forms
- Tests verify state persistence

### 3. Development Checklist (Every 30 Minutes)

- [ ] Check TypeScript errors in IDE (should have 0)
- [ ] Check unit test output (all passing)
- [ ] For UI changes: Test manually in dev mode
- [ ] Save all files and verify no new errors appear

---

## Backend Development

### 1. Setup Virtual Environment

```bash
cd apps/backend

# Create virtual environment
uv venv

# Activate it
source .venv/bin/activate  # Linux/macOS
# OR
.venv\Scripts\activate     # Windows

# Install dependencies
uv pip install -r requirements.txt
uv pip install -r ../../tests/requirements-test.txt
```

### 2. During Development

#### Run Ruff in Watch Mode

Open a terminal and run:

```bash
cd apps/backend

# Watch for file changes and lint automatically
watch -n 1 'ruff check .'
# OR on macOS
fswatch -o . | xargs -n1 -I{} ruff check .
```

#### Run Pytest in Watch Mode

Open another terminal and run:

```bash
cd apps/backend

# Using pytest-watch
.venv/bin/pytest-watch tests/

# OR using pytest with --looponfail (recommended)
.venv/bin/pytest tests/ --looponfail
```

### 3. Type Checking Python Code

```bash
cd apps/backend

# Run mypy for type checking
.venv/bin/mypy apps/backend/ --ignore-missing-imports
```

### 4. Backend Testing Strategy

#### Unit Tests

Location: `tests/`

**When to write:**
- Testing individual functions
- Testing class methods
- Testing utility modules
- Testing business logic

**Example:**
```python
# tests/test_security.py
def test_bash_command_validation():
    """Test that dangerous bash commands are blocked."""
    result = validate_command("rm -rf /")
    assert result.is_safe is False
```

#### Integration Tests

**When to write:**
- Testing agent interactions
- Testing IPC handlers
- Testing file system operations
- Testing external integrations (GitHub, Linear)

**Example:**
```python
# tests/integration/test_github_integration.py
@pytest.mark.slow
async def test_create_github_issue():
    """Test creating a GitHub issue via IPC."""
    result = await create_github_issue(title="Test", body="Test")
    assert result["success"] is True
```

### 5. Development Checklist (Every 30 Minutes)

- [ ] Run `ruff check .` (should have 0 errors)
- [ ] Check pytest output (all passing)
- [ ] Verify imports are sorted alphabetically
- [ ] Verify type hints are correct
- [ ] No trailing whitespace

---

## Testing Strategy

### Test Types by Component

| Component | Unit Tests | Integration Tests | E2E Tests |
|-----------|-----------|-------------------|-----------|
| **Frontend UI** | Component logic | State management | Full user workflows |
| **Frontend IPC** | Mock handlers | Real IPC calls | - |
| **Backend Logic** | Pure functions | Agent sessions | - |
| **Backend IPC** | Handler logic | Full IPC flow | - |
| **Backend Agents** | Agent utilities | Full agent runs | - |
| **Settings** | Store logic | Persistence | UI interactions |

### When to Write Each Type

#### Unit Tests (Required)
Write for **every new feature**:
- ✅ Fast (< 1 second per test)
- ✅ Isolated (no external dependencies)
- ✅ Specific (one thing per test)

```bash
# Frontend unit tests
cd apps/frontend && npm test

# Backend unit tests  
cd apps/backend && .venv/bin/pytest tests/ -m "not slow"
```

#### Integration Tests (For Complex Features)
Write when testing:
- Multiple components working together
- External services (GitHub, Linear)
- File system operations
- Database interactions

```bash
# Backend integration tests
cd apps/backend && .venv/bin/pytest tests/ -m slow
```

#### E2E Tests (For Critical User Flows)
Write for:
- User onboarding
- Settings changes
- Task creation and execution
- Critical workflows

```bash
# Start Electron app
npm run dev

# Run E2E via QA agent
cd apps/backend && python run.py --spec 001 --qa
```

### Coverage Goals

- **Frontend:** 80% unit test coverage (components, stores, utilities)
- **Backend:** 90% unit test coverage (core logic, utilities, agents)
- **E2E:** Cover all critical user paths

### Running All Tests

```bash
# From project root

# 1. Frontend tests
cd apps/frontend && npm test -- --run

# 2. Backend tests
apps/backend/.venv/bin/pytest tests/ -v

# 3. Full CI validation
npm run test:backend  # Backend tests
cd apps/frontend && npm run typecheck  # TypeScript
cd apps/frontend && npm run build      # Build check
npx ruff check apps/backend            # Python lint
```

---

## Full-Stack Features

When implementing a feature that spans frontend and backend:

### 1. Plan the Stack

```
Frontend (TypeScript)          Backend (Python)
├── UI Components              ├── IPC Handlers
├── State Management           ├── Business Logic
├── IPC Calls                  ├── Agent Integration
└── Unit Tests                 └── Unit Tests
```

### 2. Development Order

1. **Define the interface** (IPC contract)
   ```typescript
   // frontend/src/preload/api/types.ts
   interface ElectronAPI {
     myNewFeature: (params: Params) => Promise<Result>;
   }
   ```

2. **Implement backend first**
   ```python
   # apps/backend/ipc_handlers/my_feature.py
   def handle_my_feature(params):
       # Implementation
       return {"success": True, "data": result}
   ```

3. **Write backend tests**
   ```python
   # tests/test_my_feature.py
   def test_my_feature():
       result = handle_my_feature({"param": "value"})
       assert result["success"] is True
   ```

4. **Implement frontend**
   ```typescript
   // frontend/src/renderer/hooks/useMyFeature.ts
   export function useMyFeature() {
     const handleFeature = async () => {
       const result = await window.electronAPI.myNewFeature(params);
       return result;
     };
   }
   ```

5. **Write frontend tests**
   ```typescript
   // frontend/src/renderer/hooks/__tests__/useMyFeature.test.ts
   describe('useMyFeature', () => {
     it('should call IPC handler', async () => {
       // Test
     });
   });
   ```

6. **Write E2E test** (if UI interaction)
   ```typescript
   // Automated via QA agent or manual testing
   ```

### 3. Watch Modes for Full-Stack

Open 4 terminals:

```bash
# Terminal 1: Frontend TypeScript
cd apps/frontend && npm run typecheck -- --watch

# Terminal 2: Frontend tests
cd apps/frontend && npm test -- --watch

# Terminal 3: Backend linting
cd apps/backend && watch -n 1 'ruff check .'

# Terminal 4: Backend tests
cd apps/backend && .venv/bin/pytest tests/ --looponfail
```

---

## TypeScript Best Practices

### ✅ DO: Use Type Assertions Correctly

When testing with constant values, use type assertions to prevent literal type inference:

```typescript
// ❌ BAD - TypeScript infers literal type "icons"
const mode: 'icons' | 'full' = 'icons';
const result = mode === 'full'; // Error: comparison will always be false

// ✅ GOOD - Use type assertion in object
const settings = { navigationMode: 'icons' as 'icons' | 'full' };
const result = settings.navigationMode === 'full'; // OK
```

### ✅ DO: Type Your Mocks

```typescript
// ❌ BAD - No type
const mockFn = vi.fn();

// ✅ GOOD - Typed mock
import type { Mock } from 'vitest';

const mockFn: Mock = vi.fn();
// OR
const mockFn = vi.fn<(arg: string) => void>();
```

### ✅ DO: Use Helper Functions for Complex Logic

```typescript
// ❌ BAD - Inline comparisons in tests
it('should use w-16 width for icons mode', () => {
  const mode: 'icons' = 'icons';
  const width = mode === 'icons' ? 'w-16' : 'w-64'; // Type error
  expect(width).toBe('w-16');
});

// ✅ GOOD - Helper function
function getWidthClass(mode: 'icons' | 'full'): string {
  return mode === 'icons' ? 'w-16' : 'w-64';
}

it('should use w-16 width for icons mode', () => {
  expect(getWidthClass('icons')).toBe('w-16');
});
```

### ✅ DO: Import Types Correctly

```typescript
// ✅ GOOD - Type-only imports
import type { AppSettings } from '@shared/types';
import type { Mock } from 'vitest';

// ✅ GOOD - Regular imports for values
import { useSettingsStore } from '@stores/settings-store';
```

### ❌ DON'T: Use `any`

```typescript
// ❌ BAD
const result: any = getSomeValue();

// ✅ GOOD
const result: AppSettings = getSomeValue();
// OR
const result = getSomeValue(); // Let TypeScript infer
```

---

## Python Best Practices

### ✅ DO: Use Modern Type Hints

```python
# ❌ BAD - Old style Optional
from typing import Optional

def process_data(value: Optional[str]) -> Optional[dict]:
    pass

# ✅ GOOD - Modern union syntax (Python 3.10+)
def process_data(value: str | None) -> dict | None:
    pass
```

### ✅ DO: Sort Imports Alphabetically

```python
# ❌ BAD - Unsorted imports
import os
from pathlib import Path
import sys
from typing import Any

# ✅ GOOD - Alphabetically sorted
import os
import sys
from pathlib import Path
from typing import Any
```

Ruff will auto-sort these if you have it configured in VS Code.

### ✅ DO: Use Type Hints for Function Parameters

```python
# ❌ BAD - No type hints
def create_spec(task_description, complexity):
    pass

# ✅ GOOD - Clear type hints
def create_spec(task_description: str, complexity: str) -> dict[str, Any]:
    """Create a specification from task description."""
    pass
```

### ✅ DO: Handle Platform-Specific Code

```python
# ❌ BAD - Unconditional import
import fcntl  # Only works on Unix

# ✅ GOOD - Platform check
import sys

if sys.platform != 'win32':
    import fcntl
```

### ✅ DO: Use Docstrings for Public Functions

```python
def process_agent_response(response: dict[str, Any]) -> str | None:
    """
    Extract and process the agent's response content.
    
    Args:
        response: The raw response from the Claude SDK
        
    Returns:
        The processed response text, or None if parsing fails
    """
    # Implementation
```

### ❌ DON'T: Leave Trailing Whitespace

```python
# ❌ BAD - Trailing spaces (shown as ·)
def my_function():··
    pass··

# ✅ GOOD - No trailing whitespace
def my_function():
    pass
```

Ruff will remove these automatically on save if configured.

### ✅ DO: Use Pathlib for File Paths

```python
# ❌ BAD - String manipulation
import os
spec_path = os.path.join(base_dir, 'specs', spec_id, 'spec.md')

# ✅ GOOD - Pathlib
from pathlib import Path
spec_path = Path(base_dir) / 'specs' / spec_id / 'spec.md'
```

### ✅ DO: Use Pytest Fixtures

```python
# ✅ GOOD - Reusable test setup
import pytest

@pytest.fixture
def mock_project_dir(tmp_path):
    """Create a temporary project directory."""
    project_dir = tmp_path / "test_project"
    project_dir.mkdir()
    return project_dir

def test_create_spec(mock_project_dir):
    """Test spec creation in isolated directory."""
    spec = create_spec(mock_project_dir, "Add feature")
    assert spec is not None
```

---

## Testing Guidelines

### 1. Write Tests Alongside Code

Don't wait until the feature is "done" to write tests. Write tests as you develop:

```
1. Write a failing test
2. Implement the feature
3. Make the test pass
4. Refactor
5. Repeat
```

### 2. Test File Organization

Place test files next to the code they test:

```
src/
  components/
    Sidebar.tsx
    __tests__/
      Sidebar.test.tsx
      Sidebar.integration.test.tsx
```

Or in a dedicated test directory:

```
src/
  components/
    settings/
      DisplaySettings.tsx
      __tests__/
        DisplaySettings.NavigationMode.test.tsx
```

### 3. Test Naming Convention

```typescript
describe('ComponentName - Feature', () => {
  describe('Specific Behavior', () => {
    it('should do something specific', () => {
      // Test
    });
  });
});
```

### 4. Mock Patterns

#### Mock ElectronAPI

```typescript
import '../../../lib/browser-mock';

const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  
  if (window.electronAPI) {
    window.electronAPI.getSettings = mockGetSettings;
    window.electronAPI.saveSettings = mockSaveSettings;
  }
});
```

#### Mock Zustand Store

```typescript
const mockUpdateSettings: Mock = vi.fn();

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({
        settings: mockSettings,
        updateSettings: mockUpdateSettings,
      });
    }
    return mockSettings;
  }),
}));
```

### 5. Run Specific Tests During Development

```bash
# Run only tests in a specific file
npm test -- NavigationMode.test.tsx

# Run tests matching a pattern
npm test -- --grep "Navigation Mode"

# Run in watch mode (recommended)
npm test -- --watch
```

---

## Common Pitfalls

### 1. Constant Literal Type Comparisons

**Problem:**
```typescript
const mode: 'icons' | 'full' = 'icons';
const result = mode === 'full'; // Error: always false
```

**Solution:**
```typescript
// Use object with type assertion
const settings = { mode: 'icons' as 'icons' | 'full' };
const result = settings.mode === 'full'; // OK

// OR use helper function
function checkMode(mode: 'icons' | 'full'): boolean {
  return mode === 'full';
}
```

### 2. Mock Function Type Errors

**Problem:**
```typescript
const mockFn = vi.fn();
mockFn({ test: 'value' }); // Type error
```

**Solution:**
```typescript
import type { Mock } from 'vitest';

const mockFn: Mock = vi.fn();
mockFn({ test: 'value' }); // OK
```

### 3. Import Path Issues

**Problem:**
```typescript
import { AppSettings } from '../../../shared/types'; // Long path
```

**Solution:**
```typescript
import { AppSettings } from '@shared/types'; // Use path alias
```

Path aliases are configured in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@renderer/*": ["src/renderer/*"],
      "@main/*": ["src/main/*"]
    }
  }
}
```

### 4. Missing Type Definitions

**Problem:**
```typescript
const settings = useSettingsStore((state) => state.settings);
// Type error: state.settings doesn't exist
```

**Solution:**
```typescript
// Check the type definition
import type { SettingsState } from '../stores/settings-store';

// Ensure store is properly typed
const settings = useSettingsStore((state: SettingsState) => state.settings);
```

---

## Pre-Commit Checklist

Before committing your changes, run through this checklist:

### Automated Checks

```bash
# 1. TypeScript validation
npm run typecheck

# 2. Run all tests
npm test -- --run

# 3. Build the project
npm run build

# 4. Lint check
npm run lint
```

### Manual Checks

- [ ] All TypeScript errors resolved
- [ ] All tests passing
- [ ] No console.log statements (unless intentional)
- [ ] Code formatted (Prettier/ESLint auto-format)
- [ ] Translation keys added for all UI text
- [ ] Documentation updated (if needed)

### Git Hooks

The project uses Husky for pre-commit hooks. These run automatically:

```bash
# Pre-commit hook runs:
- Linting
- Type checking
- Tests (for changed files)
```

If the hook fails, fix the issues before committing.

---

## Quick Reference

### Common Commands

```bash
# TypeScript check (watch mode)
cd apps/frontend && npm run typecheck -- --watch

# Run tests (watch mode)
cd apps/frontend && npm test -- --watch

# Run specific test file
cd apps/frontend && npm test -- Sidebar.test.tsx

# Build project
npm run build

# Lint and fix
npm run lint -- --fix

# Format code
npm run format
```

### Keyboard Shortcuts (VS Code)

- `Cmd+Shift+P` → "TypeScript: Restart TS Server" (when TS gets confused)
- `Cmd+Shift+M` → Open problems panel (see all errors)
- `F8` → Navigate to next error
- `Shift+F8` → Navigate to previous error

---

## Example: Adding a New Feature

Here's the recommended workflow for adding a full-stack feature:

### Example: Frontend-Only Feature (Navigation Mode)

#### 1. Plan & Setup (5 min)

```bash
# Create feature branch
git checkout -b feature/navigation-mode

# Terminal 1: TypeScript watch
cd apps/frontend && npm run typecheck -- --watch &

# Terminal 2: Test watch
npm test -- --watch &
```

#### 2. Write Types → Implement → Test (1.5 hours)

Follow the frontend development workflow above.

**Total Time:** ~2 hours with continuous validation ✅

---

### Example: Full-Stack Feature (Task Export)

#### 1. Plan & Setup (10 min)

```bash
# Create feature branch
git checkout -b feature/task-export

# Terminal 1: Frontend TypeScript
cd apps/frontend && npm run typecheck -- --watch &

# Terminal 2: Frontend tests  
cd apps/frontend && npm test -- --watch &

# Terminal 3: Backend linting
cd apps/backend && watch -n 1 'ruff check .' &

# Terminal 4: Backend tests
cd apps/backend && .venv/bin/pytest tests/ --looponfail &
```

#### 2. Define IPC Interface (15 min)

```typescript
// apps/frontend/src/preload/api/types.ts
interface ElectronAPI {
  exportTask: (taskId: string, format: 'json' | 'md') => Promise<{
    success: boolean;
    data?: { filePath: string };
    error?: string;
  }>;
}
```

**Check TypeScript watch** - should pass ✅

#### 3. Implement Backend (45 min)

```python
# apps/backend/ipc_handlers/task_export.py
from pathlib import Path

def handle_export_task(task_id: str, format: str) -> dict[str, Any]:
    """Export task to file."""
    task = load_task(task_id)
    
    if format == 'json':
        content = json.dumps(task, indent=2)
        ext = '.json'
    else:
        content = generate_markdown(task)
        ext = '.md'
    
    file_path = Path(f"exports/task-{task_id}{ext}")
    file_path.write_text(content)
    
    return {"success": True, "data": {"filePath": str(file_path)}}
```

**Check backend watch** - Ruff should pass ✅

#### 4. Write Backend Tests (30 min)

```python
# tests/test_task_export.py
import pytest
from pathlib import Path

def test_export_task_json(tmp_path):
    """Test exporting task as JSON."""
    result = handle_export_task("task-001", "json")
    
    assert result["success"] is True
    assert "filePath" in result["data"]
    
    # Verify file exists and contains valid JSON
    file_path = Path(result["data"]["filePath"])
    assert file_path.exists()
    data = json.loads(file_path.read_text())
    assert data["id"] == "task-001"

def test_export_task_markdown(tmp_path):
    """Test exporting task as Markdown."""
    result = handle_export_task("task-001", "md")
    
    assert result["success"] is True
    content = Path(result["data"]["filePath"]).read_text()
    assert "# Task:" in content
```

**Check backend test watch** - should pass ✅

#### 5. Implement Frontend (30 min)

```typescript
// apps/frontend/src/renderer/hooks/useTaskExport.ts
export function useTaskExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportTask = async (taskId: string, format: 'json' | 'md') => {
    setIsExporting(true);
    try {
      const result = await window.electronAPI.exportTask(taskId, format);
      if (result.success) {
        toast.success(`Task exported to ${result.data.filePath}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return { exportTask, isExporting };
}
```

**Check TypeScript watch** - should pass ✅

#### 6. Write Frontend Tests (20 min)

```typescript
// apps/frontend/src/renderer/hooks/__tests__/useTaskExport.test.ts
describe('useTaskExport', () => {
  it('should export task successfully', async () => {
    const mockExportTask = vi.fn().mockResolvedValue({
      success: true,
      data: { filePath: '/exports/task-001.json' }
    });
    
    window.electronAPI.exportTask = mockExportTask;
    
    const { result } = renderHook(() => useTaskExport());
    await result.current.exportTask('task-001', 'json');
    
    expect(mockExportTask).toHaveBeenCalledWith('task-001', 'json');
  });
});
```

**Check frontend test watch** - should pass ✅

#### 7. Add UI & E2E Test (45 min)

```typescript
// Add export button to task detail view
// Run QA agent for E2E testing
npm run dev  # In another terminal
cd apps/backend && python run.py --spec export-task --qa
```

**E2E test verifies** - Full flow works ✅

#### 8. Final Validation (10 min)

```bash
# Stop watch processes
# Run full test suite
npm run test:backend        # Backend tests
cd apps/frontend && npm test -- --run  # Frontend tests
npm run typecheck           # TypeScript
npx ruff check apps/backend # Python lint
```

**All checks pass** ✅

#### 9. Commit

```bash
git add .
git commit -m "feat: add task export functionality (JSON and Markdown)"
# Pre-commit hooks run automatically
```

**Total Time:** ~3.5 hours with continuous validation ✅

**Time Saved:** No "debug everything at the end" phase, both stacks validated incrementally ✨

---

### 1. Plan & Setup (5 min)

```bash
# Create feature branch
git checkout -b feature/navigation-mode

# Start TypeScript watch
cd apps/frontend && npm run typecheck -- --watch &

# Start test watch
npm test -- --watch &
```

### 2. Write Types First (10 min)

```typescript
// apps/frontend/src/shared/types/settings.ts
export interface AppSettings {
  // ... existing fields
  navigationMode?: 'icons' | 'full';
}
```

Run typecheck - should still pass ✅

### 3. Add Default Value (5 min)

```typescript
// apps/frontend/src/shared/constants/config.ts
export const DEFAULT_APP_SETTINGS = {
  // ... existing
  navigationMode: 'full' as const,
};
```

Run typecheck - should still pass ✅

### 4. Implement UI (30 min)

```typescript
// apps/frontend/src/renderer/components/Sidebar.tsx
const navigationMode = settings.navigationMode || 'full';

// Add conditional rendering
{navigationMode === 'icons' ? <IconView /> : <FullView />}
```

**Check TypeScript errors in IDE as you type** - should have 0 errors ✅

### 5. Add Settings UI (20 min)

```typescript
// apps/frontend/src/renderer/components/settings/DisplaySettings.tsx
const handleNavigationModeChange = (mode: 'icons' | 'full') => {
  onSettingsChange({ ...settings, navigationMode: mode });
  updateStoreSettings({ navigationMode: mode });
};
```

**Check TypeScript watch terminal** - should have 0 errors ✅

### 6. Add Translations (10 min)

```json
// apps/frontend/src/shared/i18n/locales/en/settings.json
{
  "navigation": {
    "mode": {
      "title": "Navigation Bar Style",
      "iconsOnly": "Icons Only"
    }
  }
}
```

**Check TypeScript watch terminal** - should have 0 errors ✅

### 7. Write Tests (30 min)

```typescript
// Write test file
describe('Navigation Mode', () => {
  it('should toggle mode', () => {
    // Test implementation
  });
});
```

**Check test watch terminal** - should pass ✅

### 8. Final Validation (5 min)

```bash
# Stop watch processes
# Run full validation
npm run typecheck  # Should pass
npm test -- --run  # Should pass
npm run build      # Should succeed
```

### 9. Commit

```bash
git add .
git commit -m "feat: add navigation mode toggle"
# Pre-commit hooks run automatically
```

**Total Time:** ~2 hours with continuous validation ✅

**Time Saved:** No "fix all TypeScript errors at the end" phase ✨

---

## Tips for New Contributors

1. **Install IDE extensions** - Get TypeScript errors as you type
2. **Run watch modes** - See errors immediately, not after 30 minutes
3. **Write tests incrementally** - Don't save testing for the end
4. **Check your IDE** - If you see red squiggles, fix them now
5. **Use helper functions** - Avoid complex inline logic in tests
6. **Ask for help** - If stuck on TypeScript errors, ask early

---

## Troubleshooting

### "TypeScript errors but IDE shows none"

```bash
# Restart TS Server in VS Code
Cmd+Shift+P → "TypeScript: Restart TS Server"

# OR delete and reinstall
rm -rf node_modules package-lock.json
npm install
```

### "Tests pass but typecheck fails"

```bash
# Check if you're in the right directory
cd apps/frontend
npm run typecheck

# Check for path alias issues
# Verify tsconfig.json has correct paths
```

### "Pre-commit hook fails"

```bash
# Run the failing check manually
npm run lint
npm run typecheck
npm test

# Fix the errors, then commit again
```

---

## Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [Project CLAUDE.md](./CLAUDE.md) - Project-specific guidelines
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

---

**Remember:** The goal is to catch errors **during** development, not **after** development. Use watch modes and IDE tools to get immediate feedback!
