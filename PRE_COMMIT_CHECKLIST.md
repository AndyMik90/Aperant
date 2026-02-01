# Pre-Commit Checklist

**CRITICAL: Run ALL 4 checks before EVERY commit to ensure CI passes!**

Use this checklist before every commit to avoid CI failures and wasted time.

## ⚡ Why This Matters

**Our CI runs on 3 platforms:** Windows, macOS, and Linux. Code that works on your machine might fail on other platforms!

**Common causes of CI failures:**
- ❌ Platform-specific imports (e.g., `pty` on Windows)
- ❌ Unsorted Python imports
- ❌ Using `Optional[X]` instead of `X | None`
- ❌ Unused imports
- ❌ TypeScript type errors
- ❌ Missing React state declarations
- ❌ Duplicate imports

## ✅ Quick Checks (2 minutes)

Run these commands from the repository root **before every commit**:

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

## 📝 Expected Results

**ALL 4 commands must show success before you commit!**

| Command | Expected Output | Status | If Failed |
|---------|----------------|--------|-----------|
| `npm run test:backend` | `====== X passed in Y.Ys ======` | ⚠️ REQUIRED | See [Python Fixes](#python-fixes) |
| `npm run typecheck` | *(no output = success)* | ⚠️ REQUIRED | See [TypeScript Fixes](#typescript-fixes) |
| `npm run build` | `✓ built in Xs` | ⚠️ REQUIRED | See [Build Fixes](#build-fixes) |
| `ruff check` | *(no output = success)* | ⚠️ REQUIRED | Run `ruff check --fix` |

**🚫 DO NOT COMMIT if any check fails!** Fix the issues first.

## 🚀 Auto-Fix Commands

Try these auto-fix commands FIRST when checks fail:

```bash
# Fix Python import order, type hints, and other auto-fixable issues
npx ruff check --fix apps/backend

# Verify the fix worked
npx ruff check apps/backend
```

## 🔧 Troubleshooting Failures

### Python Fixes

**Issue: Tests fail with "ModuleNotFoundError: No module named 'pty'"**
```python
# ❌ WRONG: Importing Unix-only module
import pty

# ✅ FIX: Guard platform-specific imports
import sys

if sys.platform != 'win32':
    import pty
    import termios
```

**Issue: "Import block is un-sorted or un-formatted"**
```bash
# Auto-fix:
npx ruff check --fix apps/backend
```

**Issue: "Use `X | None` instead of `Optional[X]`"**
```python
# ❌ WRONG:
from typing import Optional
def func() -> Optional[str]:
    pass

# ✅ FIX:
def func() -> str | None:
    pass
```

### TypeScript Fixes

**Issue: "Cannot find name 'setIsLoading'"**
```typescript
// ✅ FIX: Add missing state declaration
const [isLoading, setIsLoading] = useState(false);
```

**Issue: "Duplicate identifier 'Badge'"**
```typescript
// ❌ WRONG:
import { Badge } from './ui/badge';
import { Badge } from './ui/badge';  // Remove this

// ✅ FIX:
import { Badge } from './ui/badge';
```

### Build Fixes

**Issue: Build fails with module not found**
- Check for typos in import paths
- Verify the imported file exists
- Remove duplicate imports

## 📋 Manual Checks

Before committing, verify:

- [ ] **Platform compatibility**: Platform-specific imports wrapped in `if sys.platform != 'win32'`
- [ ] **Path handling**: Using `pathlib.Path` instead of string paths
- [ ] **No duplicate imports** in TypeScript files
- [ ] **All React state variables declared** (`useState`)
- [ ] **Modern Python type hints** (`X | None` not `Optional[X]`)
- [ ] **No trailing whitespace** in Python files
- [ ] **Tests written** for new features
- [ ] **i18n translation keys** used (no hardcoded strings in frontend)

## ⚠️ Common Issues

### Python Import Order
```python
# ✅ CORRECT: Alphabetically sorted, grouped properly
import logging
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from .local_module import function
```

### Type Annotations
```python
# ✅ CORRECT: Use | None
def find_user(id: str) -> User | None:
    pass

# ❌ WRONG: Don't use Optional
from typing import Optional
def find_user(id: str) -> Optional[User]:
    pass
```

### TypeScript State
```typescript
// ✅ CORRECT: Declare before use
const [isLoading, setIsLoading] = useState(false);

// Later:
setIsLoading(true);  // Works!

// ❌ WRONG: Using undeclared setter
setIsLoading(true);  // ERROR: not defined!
```

### Platform-Specific Imports
```python
# ✅ CORRECT: Guard Unix-only imports
import sys

if sys.platform != 'win32':
    from .terminals import router as terminals_router
else:
    from fastapi import APIRouter
    terminals_router = APIRouter()

# ❌ WRONG: Direct import fails on Windows
from .terminals import router as terminals_router
```

## 🎯 All Green?

**If all 4 commands pass with expected output:**

```bash
git add .
git commit -m "feat: your changes here"
git push
```

## ❌ Still Failing?

1. **Read the error message carefully** - It usually tells you exactly what's wrong
2. **Check the section above** for common fixes
3. **Run the failing command individually** to see detailed output
4. **Check [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** for detailed explanations

## 💡 Pro Tips

- **Run checks frequently** while developing, not just before committing
- **Fix ruff issues immediately** - `npx ruff check --fix` handles most cases
- **Use VS Code extensions** - ESLint, Ruff, and TypeScript provide real-time feedback
- **Test on Windows if possible** - Most CI failures are Windows-specific

## 🔄 Workflow Summary

```
Write code
   ↓
Run 4 checks ← ─┐
   ↓            │
All pass?       │
   ↓ Yes        │
Commit & Push   │
                │
   No ───────────┘
   ↓
Fix issues
```

## 📚 Full Guide

For detailed explanations, troubleshooting, and best practices:
- **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** - Comprehensive development guide
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines
