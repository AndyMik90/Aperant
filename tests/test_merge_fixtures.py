#!/usr/bin/env python3
"""
Shared Fixtures and Sample Data for Merge Tests
================================================

Contains:
- Sample code snippets (React, Python, TypeScript)
- Common test fixtures for merge components
- Factory functions for creating test data
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import Callable, Generator

import pytest

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from merge import (
    SemanticAnalyzer,
    ConflictDetector,
    AutoMerger,
    FileEvolutionTracker,
    AIResolver,
)


# =============================================================================
# SAMPLE CODE CONSTANTS
# =============================================================================

SAMPLE_REACT_COMPONENT = '''import React from 'react';
import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Hello World</h1>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </div>
  );
}

export default App;
'''

SAMPLE_REACT_WITH_HOOK = '''import React from 'react';
import { useState } from 'react';
import { useAuth } from './hooks/useAuth';

function App() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();

  return (
    <div>
      <h1>Hello World</h1>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </div>
  );
}

export default App;
'''

SAMPLE_REACT_WITH_WRAP = '''import React from 'react';
import { useState } from 'react';
import { ThemeProvider } from './context/Theme';

function App() {
  const [count, setCount] = useState(0);

  return (
    <ThemeProvider>
      <div>
        <h1>Hello World</h1>
        <button onClick={() => setCount(count + 1)}>
          Count: {count}
        </button>
      </div>
    </ThemeProvider>
  );
}

export default App;
'''

SAMPLE_PYTHON_MODULE = '''"""Sample Python module."""
import os
from pathlib import Path

def hello():
    """Say hello."""
    print("Hello")

def goodbye():
    """Say goodbye."""
    print("Goodbye")

class Greeter:
    """A greeter class."""

    def greet(self, name: str) -> str:
        return f"Hello, {name}"
'''

SAMPLE_PYTHON_WITH_NEW_IMPORT = '''"""Sample Python module."""
import os
import logging
from pathlib import Path

def hello():
    """Say hello."""
    print("Hello")

def goodbye():
    """Say goodbye."""
    print("Goodbye")

class Greeter:
    """A greeter class."""

    def greet(self, name: str) -> str:
        return f"Hello, {name}"
'''

SAMPLE_PYTHON_WITH_NEW_FUNCTION = '''"""Sample Python module."""
import os
from pathlib import Path

def hello():
    """Say hello."""
    print("Hello")

def goodbye():
    """Say goodbye."""
    print("Goodbye")

def new_function():
    """A new function."""
    return 42

class Greeter:
    """A greeter class."""

    def greet(self, name: str) -> str:
        return f"Hello, {name}"
'''


# =============================================================================
# PROJECT FIXTURES
# =============================================================================

@pytest.fixture
def temp_project(tmp_path: Path) -> Generator[Path, None, None]:
    """Create a temporary project directory with git repo.

    IMPORTANT: This fixture properly isolates git operations by clearing
    git environment variables that may be set by pre-commit hooks. Without
    this isolation, git operations could affect the parent repository when
    tests run inside a git worktree (e.g., during pre-commit validation).
    """
    # Save original environment values to restore later
    orig_env = {}

    # These git env vars may be set by pre-commit hooks and MUST be cleared
    git_vars_to_clear = [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ]

    # Clear interfering git environment variables
    for key in git_vars_to_clear:
        orig_env[key] = os.environ.get(key)
        if key in os.environ:
            del os.environ[key]

    # Set GIT_CEILING_DIRECTORIES to prevent git from discovering parent .git
    orig_env["GIT_CEILING_DIRECTORIES"] = os.environ.get("GIT_CEILING_DIRECTORIES")
    os.environ["GIT_CEILING_DIRECTORIES"] = str(tmp_path.parent)

    try:
        # Initialize git repo
        subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=tmp_path, capture_output=True
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=tmp_path, capture_output=True
        )

        # Create initial files
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "App.tsx").write_text(SAMPLE_REACT_COMPONENT)
        (tmp_path / "src" / "utils.py").write_text(SAMPLE_PYTHON_MODULE)

        # Initial commit
        subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=tmp_path, capture_output=True
        )

        # Ensure branch is named 'main' (some git configs default to 'master')
        subprocess.run(["git", "branch", "-M", "main"], cwd=tmp_path, capture_output=True)

        yield tmp_path
    finally:
        # Restore original environment variables
        for key, value in orig_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


# =============================================================================
# COMPONENT FIXTURES
# =============================================================================

@pytest.fixture
def semantic_analyzer() -> SemanticAnalyzer:
    """Create a SemanticAnalyzer instance."""
    return SemanticAnalyzer()


@pytest.fixture
def conflict_detector() -> ConflictDetector:
    """Create a ConflictDetector instance."""
    return ConflictDetector()


@pytest.fixture
def auto_merger() -> AutoMerger:
    """Create an AutoMerger instance."""
    return AutoMerger()


@pytest.fixture
def file_tracker(temp_project: Path) -> FileEvolutionTracker:
    """Create a FileEvolutionTracker instance."""
    return FileEvolutionTracker(temp_project)


@pytest.fixture
def ai_resolver() -> AIResolver:
    """Create an AIResolver without AI function (for unit tests)."""
    return AIResolver()


@pytest.fixture
def mock_ai_resolver() -> AIResolver:
    """Create an AIResolver with mocked AI function."""
    def mock_ai_call(system: str, user: str) -> str:
        return """```typescript
const merged = useAuth();
const other = useOther();
return <div>Merged</div>;
```"""
    return AIResolver(ai_call_fn=mock_ai_call)


# =============================================================================
# FACTORY FIXTURES
# =============================================================================

@pytest.fixture
def make_ai_resolver() -> Callable:
    """Factory for creating AIResolver with custom mock responses."""
    def _make_resolver(response: str = None) -> AIResolver:
        if response is None:
            response = """```python
def merged():
    return "auto-merged"
```"""

        def mock_ai_call(system: str, user: str) -> str:
            return response

        return AIResolver(ai_call_fn=mock_ai_call)

    return _make_resolver
