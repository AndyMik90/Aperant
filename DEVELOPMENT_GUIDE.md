# Development Guide

This guide ensures all code contributions pass CI checks on the first attempt.

## Table of Contents
1. [Quick Checklist](#quick-checklist)
2. [Python Backend Standards](#python-backend-standards)
3. [TypeScript Frontend Standards](#typescript-frontend-standards)
4. [Testing Requirements](#testing-requirements)
5. [CI/CD Verification](#cicd-verification)

---

## Quick Checklist

**CRITICAL: Run these checks BEFORE every commit to avoid CI failures!**

Before committing code, ensure:

- [ ] **Python**: All imports sorted alphabetically
- [ ] **Python**: Modern type hints (`X | None` not `Optional[X]`)
- [ ] **Python**: No unused imports
- [ ] **Python**: No trailing whitespace
- [ ] **Python**: Platform-specific imports wrapped in `if sys.platform != 'win32'`
- [ ] **TypeScript**: No duplicate imports
- [ ] **TypeScript**: All state variables declared
- [ ] **TypeScript**: Type-safe (no `any` types without justification)
- [ ] **Tests**: Written for new features
- [ ] **Tests**: Pass on all platforms (Windows/macOS/Linux)
- [ ] **CI**: All 4 local checks pass (see below)

### Required Local Checks (Run from repository root)

```bash
# 1. Backend tests
npm run test:backend

# 2. TypeScript type check
cd apps/frontend && npm run typecheck && cd ../..

# 3. Frontend build
cd apps/frontend && npm run build && cd ../..

# 4. Python linting
npx ruff check apps/backend
```

**All 4 must pass before pushing!** If any fail, fix them immediately.

---

## Python Backend Standards

### 1. Import Order (Ruff Rule: I001)

**✅ CORRECT:**
```python
"""Module docstring."""

import logging
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from .local_module import function
```

**❌ WRONG:**
```python
"""Module docstring."""

from fastapi import APIRouter
import sys  # Wrong order
import logging
from pydantic import BaseModel
from pathlib import Path

from .local_module import function
```

**Rules:**
1. Standard library imports first (alphabetically)
2. Blank line
3. Third-party imports (alphabetically)
4. Blank line
5. Local imports (alphabetically)

### 2. Type Annotations (Ruff Rule: UP045)

**✅ CORRECT:**
```python
def find_user(user_id: str) -> User | None:
    """Find user by ID."""
    pass

class UserProfile(BaseModel):
    name: str
    email: str | None = None
    age: int | None = None
```

**❌ WRONG:**
```python
from typing import Optional  # Don't use Optional

def find_user(user_id: str) -> Optional[User]:  # Use | None instead
    """Find user by ID."""
    pass

class UserProfile(BaseModel):
    name: str
    email: Optional[str] = None  # Use | None
    age: Optional[int] = None
```

**Rules:**
- Use `X | None` instead of `Optional[X]` (Python 3.10+)
- Use `tuple[str, int]` instead of `Tuple[str, int]`
- Don't import from `typing` if not needed

### 3. Remove Unused Imports (Ruff Rule: F401)

**✅ CORRECT:**
```python
import logging  # Used
from pathlib import Path  # Used

logger = logging.getLogger(__name__)
config_path = Path("/etc/config")
```

**❌ WRONG:**
```python
import logging  # Used
import json  # UNUSED - remove this
from pathlib import Path  # Used

logger = logging.getLogger(__name__)
config_path = Path("/etc/config")
```

### 4. No Trailing Whitespace (Ruff Rule: W291)

**✅ CORRECT:**
```python
def process_data(data: dict) -> None:
    """Process data."""
    result = transform(data)
    return result
```

**❌ WRONG:**
```python
def process_data(data: dict) -> None:
    """Process data."""···  # Trailing spaces
    result = transform(data)···
    return result
```

### 5. Platform-Specific Code

**CRITICAL: CI runs on Windows, macOS, AND Linux. Code must work on all platforms!**

When importing Unix-only modules (e.g., `pty`, `termios`):

**✅ CORRECT:**
```python
import sys

if sys.platform != 'win32':
    import pty
    import termios
    # Unix-specific code
else:
    # Windows fallback
    pass
```

**❌ WRONG:**
```python
import pty  # Fails on Windows CI!
import termios  # Not available on Windows!
```

**Common Unix-only modules to guard:**
- `pty` - Pseudo-terminal utilities
- `termios` - Terminal I/O control
- `fcntl` - File control and I/O control
- `grp` - Group database
- `pwd` - Password database

**Best Practice:** Always test platform-specific code or use cross-platform alternatives from `pathlib`, `os`, or `shutil`.

---

## TypeScript Frontend Standards

### 1. No Duplicate Imports

**✅ CORRECT:**
```typescript
import { Badge } from './ui/badge';
import { Button } from './ui/button';
```

**❌ WRONG:**
```typescript
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Badge } from './ui/badge';  // DUPLICATE!
```

### 2. Declare All State Variables

**✅ CORRECT:**
```typescript
export function MyComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Data[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Now you can use setIsLoading, setSelectedId, etc.
}
```

**❌ WRONG:**
```typescript
export function MyComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Data[]>([]);
  // Missing: selectedId state declaration

  // Later in code:
  setSelectedId(id);  // ERROR: not defined!
}
```

### 3. Use Translation Keys (i18n)

**✅ CORRECT:**
```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation(['common', 'dialogs']);
  
  return <span>{t('common:labels.save')}</span>;
}
```

**❌ WRONG:**
```typescript
function MyComponent() {
  return <span>Save</span>;  // Hardcoded string!
}
```

---

## Testing Requirements

**CRITICAL: All tests must pass on Windows, macOS, AND Linux!**

### 1. Test File Structure

**Location:**
- Backend tests: `tests/test_<module_name>.py`
- Frontend tests: `apps/frontend/src/**/*.test.ts(x)`

**Structure:**
```python
#!/usr/bin/env python3
"""
Tests for <Module Name>
=======================

Description of what this test file covers.
"""

import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def sample_fixture():
    """Fixture description."""
    return {"key": "value"}


def test_basic_functionality(sample_fixture):
    """Test basic functionality."""
    assert sample_fixture["key"] == "value"


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="Unix-only feature"
)
def test_unix_specific():
    """Test Unix-specific functionality."""
    pass
```

### 2. Platform-Specific Test Considerations

**Windows Compatibility:**
- Use `pathlib.Path` instead of string paths
- Avoid hardcoded forward slashes (`/`) or backslashes (`\`)
- Skip Unix-only tests with `@pytest.mark.skipif`
- Don't assume Unix commands are available (e.g., `ls`, `grep`)

**Example - Cross-platform path testing:**
```python
from pathlib import Path

def test_file_creation():
    """Test works on all platforms."""
    # ✅ CORRECT: Use pathlib
    test_file = Path("test_dir") / "file.txt"
    
    # ❌ WRONG: Hardcoded separators
    test_file = "test_dir/file.txt"  # Fails on Windows
```

### 3. Mock External Dependencies

**✅ CORRECT:**
```python
@patch('subprocess.run')
def test_command_execution(mock_run):
    """Test command execution without actually running it."""
    mock_run.return_value = MagicMock(
        returncode=0,
        stdout="success"
    )
    result = execute_command("test")
    assert result == "success"
```

### 4. Test Assertions

**Common assertion mistakes:**

**✅ CORRECT:**
```python
# Use exact equality for strings
assert result == "expected_value"

# Use 'in' for substring checks
assert "substring" in result

# Use Path for file comparisons
assert Path(result).exists()
```

**❌ WRONG:**
```python
# Don't use regex without importing re
assert result.startswith("value")  # OK
assert re.match(pattern, result)  # Need: import re

# Don't assume path separators
assert result == "dir/file.txt"  # Fails on Windows
```
    return {"key": "value"}


class TestFeatureName:
    """Tests for specific feature."""

    def test_feature_does_something(self, sample_fixture):
        """Test that feature does X when Y."""
        # Arrange
        input_data = sample_fixture
        
        # Act
        result = function_under_test(input_data)
        
        # Assert
        assert result == expected_value

    def test_feature_handles_error(self):
        """Test that feature handles error case Z."""
        with pytest.raises(ValueError):
            function_under_test(invalid_input)
```

### 2. Test Coverage Requirements

**Minimum Coverage:**
- New features: **80%** code coverage
- Bug fixes: Add test that reproduces the bug
- API endpoints: Test success, validation, and error cases

**Required Test Cases:**
```python
class TestAPIEndpoint:
    """Tests for API endpoint."""
    
    def test_success_case(self):
        """Test successful request."""
        pass
    
    def test_validation_error(self):
        """Test validation errors return 422."""
        pass
    
    def test_not_found_error(self):
        """Test 404 for missing resources."""
        pass
    
    def test_permission_error(self):
        """Test 403 for unauthorized access."""
        pass
```

### 3. Mock External Dependencies

**✅ CORRECT:**
```python
def test_api_call_success():
    """Test API call with mocked HTTP client."""
    with patch('httpx.AsyncClient') as mock_client:
        mock_client.return_value.__aenter__.return_value.get.return_value.status_code = 200
        
        result = call_external_api()
        
        assert result.success is True
```

**❌ WRONG:**
```python
def test_api_call_success():
    """Test API call - makes real HTTP request!"""
    result = call_external_api()  # Don't make real API calls in tests!
    assert result.success is True
```

---

## CI/CD Verification

**CRITICAL: Our CI runs on 3 platforms - Windows, macOS, AND Linux!**

### Platform Testing Strategy

**Windows:**
- No Unix modules available (`pty`, `termios`, `fcntl`)
- Path separators: `\` (always use `pathlib.Path`)
- Shell: PowerShell/CMD

**macOS/Linux:**
- Unix modules available
- Path separators: `/` (always use `pathlib.Path`)

**Cross-platform code:**
```python
import sys
from pathlib import Path

# ✅ Always use Path for cross-platform compatibility
config_path = Path.home() / ".config" / "app.json"

# ✅ Platform-specific imports
if sys.platform != 'win32':
    import pty  # Unix-only
```

### Local Pre-Commit Checks

**Run these 4 commands before EVERY commit to avoid CI failures:**

#### 1. Backend Tests
```bash
# From root:
npm run test:backend

# Or directly:
cd apps/backend && .venv/Scripts/pytest tests/ -v
```

**Expected output:**
```
====== X passed in Y.Ys ======
```

**If tests fail:**
- Check for platform-specific imports without guards
- Verify path handling uses `pathlib.Path`
- Ensure mocks are set up correctly

#### 2. TypeScript Type Check
```bash
cd apps/frontend && npm run typecheck && cd ../..
```

**Expected output:**
```
> auto-claude-ui@X.X.X typecheck
> tsc --noEmit

# (no output = success)
```

**If typecheck fails:**
- Add missing type declarations
- Fix any `any` types
- Declare all state variables in React components

#### 3. Frontend Build
```bash
cd apps/frontend && npm run build && cd ../..
```

**Expected output:**
```
✓ built in Xs
```

**If build fails:**
- Check for duplicate imports
- Verify all imported modules exist
- Fix TypeScript errors

#### 4. Python Linting (Ruff)
```bash
# From root directory
npx ruff check apps/backend
```

**Expected output:**
```
# (no output = success)
```

**If linting fails:**
```bash
# Auto-fix most issues:
npx ruff check --fix apps/backend

# Then check again:
npx ruff check apps/backend
```

### CI Pipeline Checks

The GitHub Actions CI runs on **three platforms**:
- ✅ Windows (windows-latest)
- ✅ macOS (macos-latest)
- ✅ Linux (ubuntu-latest)

**All must pass for PR to merge.**

#### Platform-Specific Considerations

**Windows:**
- No `pty`, `termios` modules available
- Use `sys.platform != 'win32'` checks
- Path separators: `\` (use `pathlib.Path`)

**macOS/Linux:**
- Unix modules available
- Path separators: `/` (use `pathlib.Path`)

**Cross-platform code:**
```python
import sys
from pathlib import Path

# Always use Path for cross-platform compatibility
config_path = Path.home() / ".config" / "app.json"

# Platform-specific imports
if sys.platform != 'win32':
    import pty  # Unix-only
```

---

## Common Issues & Fixes

### Issue: "Import block is un-sorted or un-formatted"

**Fix:**
```bash
# Auto-fix import order
ruff check --fix apps/backend/web/main.py
```

Or manually sort:
1. Standard library (alphabetically)
2. Third-party packages (alphabetically)
3. Local imports (alphabetically)

### Issue: "Use `X | None` instead of `Optional[X]`"

**Fix:**
```python
# Before
from typing import Optional
def func() -> Optional[str]:
    pass

# After
def func() -> str | None:
    pass
```

### Issue: "Duplicate identifier 'Badge'"

**Fix:**
```typescript
// Before
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Badge } from './ui/badge';  // Remove this

// After
import { Badge } from './ui/badge';
import { Button } from './ui/button';
```

### Issue: "Cannot find name 'setIsPublishing'"

**Fix:**
```typescript
// Add missing state declaration
const [isPublishing, setIsPublishing] = useState(false);
```

---

## Code Review Checklist

Before requesting review:

### Python Code
- [ ] All imports sorted alphabetically
- [ ] Using `X | None` instead of `Optional[X]`
- [ ] No unused imports
- [ ] No trailing whitespace
- [ ] Docstrings for public functions/classes
- [ ] Type hints on function signatures
- [ ] Tests written and passing

### TypeScript Code
- [ ] No duplicate imports
- [ ] All state variables declared
- [ ] Using i18n translation keys
- [ ] No hardcoded strings
- [ ] Type-safe (no `any` types)
- [ ] Tests written and passing

### General
- [ ] `npm run test:backend` passes
- [ ] `npm run typecheck` passes (frontend)
- [ ] `npm run build` passes (frontend)
- [ ] `ruff check apps/backend` passes
- [ ] Git commit message follows conventional commits
- [ ] PR description explains changes

---

## Auto-Formatting Configuration

### Ruff Configuration

File: `ruff.toml` (already configured)

```toml
[lint]
select = [
    "E",      # pycodestyle errors
    "W",      # pycodestyle warnings
    "F",      # Pyflakes
    "I",      # isort (import sorting)
    "B",      # flake8-bugbear
    "C4",     # flake8-comprehensions
    "UP",     # pyupgrade (modern Python syntax)
]
```

### VSCode Settings

Add to `.vscode/settings.json`:

```json
{
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": true,
    "source.fixAll": true
  },
  "typescript.format.enable": true,
  "typescript.validate.enable": true
}
```

---

## Troubleshooting

### Tests Fail on Import

**Problem:**
```
ModuleNotFoundError: No module named 'termios'
```

**Solution:**
Make imports conditional:
```python
import sys

if sys.platform != 'win32':
    from .terminals import router as terminals_router
else:
    from fastapi import APIRouter
    terminals_router = APIRouter()
```

### Ruff Shows Many Errors

**Problem:**
```
apps/backend/web/main.py:34:1: I001 Import block is un-sorted or un-formatted
```

**Solution:**
```bash
# Auto-fix all fixable issues
ruff check --fix apps/backend/

# Check what remains
ruff check apps/backend/
```

### TypeScript Build Fails

**Problem:**
```
error TS2304: Cannot find name 'setIsLoading'
```

**Solution:**
Add missing state declaration:
```typescript
const [isLoading, setIsLoading] = useState(false);
```

---

## Quick Reference

### Run All Checks Locally

```bash
# Backend tests
npm run test:backend

# Frontend type check
cd apps/frontend && npm run typecheck

# Frontend build
cd apps/frontend && npm run build

# Python linting
npx ruff check apps/backend
```

### Auto-Fix Issues

```bash
# Fix Python import order and other auto-fixable issues
npx ruff check --fix apps/backend

# Format TypeScript
cd apps/frontend && npm run lint
```

---

## Additional Resources

- [Ruff Documentation](https://docs.astral.sh/ruff/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Pytest Documentation](https://docs.pytest.org/)
- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)

---

## Summary

**Before every commit:**

1. ✅ Run tests: `npm run test:backend`
2. ✅ Type check: `cd apps/frontend && npm run typecheck`
3. ✅ Lint Python: `npx ruff check apps/backend`
4. ✅ Build frontend: `cd apps/frontend && npm run build`

**If any fail:**
- Check this guide for solutions
- Use `ruff check --fix` for auto-fixes
- Add missing imports/state declarations
- Write tests for new features

**All green?** ✅ Ready to commit and push!
