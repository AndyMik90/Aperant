#!/usr/bin/env python3
"""
Tests for Git Conflict Marker Parsing
======================================

Tests parsing and handling of git conflict markers for AI-based resolution.

Covers:
- Parsing single and multiple conflict markers
- Extracting context around conflicts
- Extracting AI resolutions from responses
- Reassembling files with resolved conflicts
- Building conflict-only prompts
- Full integration flow
"""

import pytest
from merge.prompts import (
    build_conflict_only_prompt,
    extract_conflict_resolutions,
    parse_conflict_markers,
    reassemble_with_resolutions,
)


class TestConflictMarkerParsing:
    """Tests for git conflict marker parsing."""

    def test_parse_single_conflict(self):
        """Parse a file with a single conflict marker."""
        content = '''def hello():
    print("Hello")

<<<<<<< HEAD
def foo():
    return "main version"
=======
def foo():
    return "feature version"
>>>>>>> feature-branch

def goodbye():
    print("Goodbye")
'''
        conflicts, _ = parse_conflict_markers(content)

        assert len(conflicts) == 1
        assert conflicts[0]['id'] == 'CONFLICT_1'
        assert 'main version' in conflicts[0]['main_lines']
        assert 'feature version' in conflicts[0]['worktree_lines']

    def test_parse_multiple_conflicts(self):
        """Parse a file with multiple conflict markers."""
        content = '''import os
<<<<<<< HEAD
import logging
=======
import json
>>>>>>> feature

def main():
    pass

<<<<<<< HEAD
def helper1():
    return 1
=======
def helper2():
    return 2
>>>>>>> feature
'''
        conflicts, _ = parse_conflict_markers(content)

        assert len(conflicts) == 2
        assert conflicts[0]['id'] == 'CONFLICT_1'
        assert conflicts[1]['id'] == 'CONFLICT_2'
        assert 'logging' in conflicts[0]['main_lines']
        assert 'json' in conflicts[0]['worktree_lines']
        assert 'helper1' in conflicts[1]['main_lines']
        assert 'helper2' in conflicts[1]['worktree_lines']

    def test_parse_no_conflicts(self):
        """Parse a file with no conflicts returns empty list."""
        content = '''def hello():
    print("Hello")

def goodbye():
    print("Goodbye")
'''
        conflicts, _ = parse_conflict_markers(content)

        assert len(conflicts) == 0

    def test_parse_conflict_with_context(self):
        """Conflict includes surrounding context."""
        content = '''line 1
line 2
line 3
<<<<<<< HEAD
conflict main
=======
conflict feature
>>>>>>> feature
line after 1
line after 2
'''
        conflicts, _ = parse_conflict_markers(content)

        assert len(conflicts) == 1
        # Should have context before
        assert 'line 3' in conflicts[0]['context_before']
        # Should have context after
        assert 'line after 1' in conflicts[0]['context_after']

    def test_parse_multiline_conflict(self):
        """Parse conflict with multiple lines on each side."""
        content = '''start
<<<<<<< HEAD
line 1 from main
line 2 from main
line 3 from main
=======
line 1 from feature
line 2 from feature
>>>>>>> feature
end
'''
        conflicts, _ = parse_conflict_markers(content)

        assert len(conflicts) == 1
        assert 'line 1 from main' in conflicts[0]['main_lines']
        assert 'line 3 from main' in conflicts[0]['main_lines']
        assert 'line 1 from feature' in conflicts[0]['worktree_lines']
        assert 'line 2 from feature' in conflicts[0]['worktree_lines']


class TestConflictResolutionExtraction:
    """Tests for extracting resolved code from AI responses."""

    def test_extract_single_resolution(self):
        """Extract resolution for a single conflict."""
        response = '''Here's the resolved code:

--- CONFLICT_1 RESOLVED ---
```python
def foo():
    return "merged version"
```

This combines both changes.
'''
        conflicts = [{'id': 'CONFLICT_1'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'python')

        assert 'CONFLICT_1' in resolutions
        assert 'merged version' in resolutions['CONFLICT_1']

    def test_extract_multiple_resolutions(self):
        """Extract resolutions for multiple conflicts."""
        response = '''Resolving all conflicts:

--- CONFLICT_1 RESOLVED ---
```python
import logging
import json
```

--- CONFLICT_2 RESOLVED ---
```python
def helper():
    return "combined"
```

Done.
'''
        conflicts = [{'id': 'CONFLICT_1'}, {'id': 'CONFLICT_2'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'python')

        assert 'CONFLICT_1' in resolutions
        assert 'CONFLICT_2' in resolutions
        assert 'logging' in resolutions['CONFLICT_1']
        assert 'json' in resolutions['CONFLICT_1']
        assert 'helper' in resolutions['CONFLICT_2']

    def test_extract_fallback_single_code_block(self):
        """Fallback: extract single code block for single conflict."""
        response = '''Here's the merged code:

```python
def foo():
    return "merged"
```
'''
        conflicts = [{'id': 'CONFLICT_1'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'python')

        assert 'CONFLICT_1' in resolutions
        assert 'merged' in resolutions['CONFLICT_1']

    def test_extract_case_insensitive(self):
        """Resolution markers are case-insensitive."""
        response = '''--- conflict_1 resolved ---
```python
result = "case insensitive"
```
'''
        conflicts = [{'id': 'CONFLICT_1'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'python')

        assert 'CONFLICT_1' in resolutions

    def test_extract_typescript_resolution(self):
        """Extract TypeScript resolutions correctly."""
        response = '''--- CONFLICT_1 RESOLVED ---
```typescript
export const config = {
  merged: true
};
```
'''
        conflicts = [{'id': 'CONFLICT_1'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'typescript')

        assert 'CONFLICT_1' in resolutions
        assert 'merged: true' in resolutions['CONFLICT_1']

    def test_extract_no_resolutions(self):
        """No resolutions when AI response doesn't match format."""
        response = '''I couldn't resolve these conflicts automatically.
Please review manually.
'''
        conflicts = [{'id': 'CONFLICT_1'}]
        resolutions = extract_conflict_resolutions(response, conflicts, 'python')

        assert len(resolutions) == 0


class TestReassemblyWithResolutions:
    """Tests for reassembling files with resolved conflicts."""

    def test_reassemble_single_conflict(self):
        """Reassemble file with single resolved conflict."""
        original = '''before
<<<<<<< HEAD
main version
=======
feature version
>>>>>>> feature
after
'''
        conflicts = [{
            'id': 'CONFLICT_1',
            'start': original.index('<<<<<<<'),
            'end': original.index('>>>>>>> feature') + len('>>>>>>> feature\n'),
            'main_lines': 'main version',
            'worktree_lines': 'feature version',
        }]
        resolutions = {'CONFLICT_1': 'merged version'}

        result = reassemble_with_resolutions(original, conflicts, resolutions)

        assert '<<<<<<' not in result
        assert '=======' not in result
        assert '>>>>>>>' not in result
        assert 'merged version' in result
        assert 'before' in result
        assert 'after' in result

    def test_reassemble_fallback_without_resolution(self):
        """Fallback to worktree version when no resolution provided."""
        original = '''before
<<<<<<< HEAD
main version
=======
feature version
>>>>>>> feature
after
'''
        conflicts = [{
            'id': 'CONFLICT_1',
            'start': original.index('<<<<<<<'),
            'end': original.index('>>>>>>> feature') + len('>>>>>>> feature\n'),
            'main_lines': 'main version',
            'worktree_lines': 'feature version',
        }]
        resolutions = {}  # No resolution provided

        result = reassemble_with_resolutions(original, conflicts, resolutions)

        # Should fall back to worktree version
        assert 'feature version' in result
        assert '<<<<<<' not in result


class TestBuildConflictOnlyPrompt:
    """Tests for building conflict-only prompts."""

    def test_build_prompt_single_conflict(self):
        """Build prompt for single conflict."""
        conflicts = [{
            'id': 'CONFLICT_1',
            'main_lines': 'def foo():\n    return "main"',
            'worktree_lines': 'def foo():\n    return "feature"',
            'context_before': 'import os',
            'context_after': 'def bar():',
        }]

        prompt = build_conflict_only_prompt(
            file_path='test.py',
            conflicts=conflicts,
            spec_name='feature-branch',
            language='python',
        )

        assert 'test.py' in prompt
        assert 'CONFLICT_1' in prompt
        assert 'MAIN BRANCH VERSION' in prompt
        assert 'FEATURE BRANCH VERSION' in prompt
        assert 'return "main"' in prompt
        assert 'return "feature"' in prompt
        assert 'CONTEXT BEFORE' in prompt
        assert 'import os' in prompt

    def test_build_prompt_multiple_conflicts(self):
        """Build prompt for multiple conflicts."""
        conflicts = [
            {
                'id': 'CONFLICT_1',
                'main_lines': 'import logging',
                'worktree_lines': 'import json',
                'context_before': '',
                'context_after': '',
            },
            {
                'id': 'CONFLICT_2',
                'main_lines': 'helper1()',
                'worktree_lines': 'helper2()',
                'context_before': '',
                'context_after': '',
            },
        ]

        prompt = build_conflict_only_prompt(
            file_path='test.py',
            conflicts=conflicts,
            spec_name='feature',
            language='python',
        )

        assert 'CONFLICT_1' in prompt
        assert 'CONFLICT_2' in prompt
        assert '2 conflict(s)' in prompt

    def test_build_prompt_includes_task_intent(self):
        """Prompt includes task intent when provided."""
        conflicts = [{
            'id': 'CONFLICT_1',
            'main_lines': 'old code',
            'worktree_lines': 'new code',
            'context_before': '',
            'context_after': '',
        }]
        task_intent = {
            'title': 'Add user authentication',
            'description': 'Implement OAuth login flow',
        }

        prompt = build_conflict_only_prompt(
            file_path='auth.py',
            conflicts=conflicts,
            spec_name='auth-feature',
            language='python',
            task_intent=task_intent,
        )

        assert 'Add user authentication' in prompt
        assert 'OAuth login flow' in prompt

    def test_build_prompt_typescript(self):
        """Build prompt for TypeScript file."""
        conflicts = [{
            'id': 'CONFLICT_1',
            'main_lines': 'const x: number = 1;',
            'worktree_lines': 'const x: string = "1";',
            'context_before': '',
            'context_after': '',
        }]

        prompt = build_conflict_only_prompt(
            file_path='index.ts',
            conflicts=conflicts,
            spec_name='feature',
            language='typescript',
        )

        assert 'typescript' in prompt.lower()
        assert '```typescript' in prompt


class TestConflictOnlyMergeIntegration:
    """Integration tests for the full conflict-only merge flow."""

    def test_full_flow_single_conflict(self):
        """Full flow: parse -> extract resolution -> reassemble."""
        # Simulated file with conflict
        file_with_conflict = '''import os

<<<<<<< HEAD
def foo():
    return "from main"
=======
def foo():
    return "from feature"
>>>>>>> feature

def bar():
    pass
'''
        # Step 1: Parse conflicts
        conflicts, _ = parse_conflict_markers(file_with_conflict)
        assert len(conflicts) == 1

        # Step 2: Simulate AI response
        ai_response = '''--- CONFLICT_1 RESOLVED ---
```python
def foo():
    return "merged: main + feature"
```
'''
        # Step 3: Extract resolutions
        resolutions = extract_conflict_resolutions(ai_response, conflicts, 'python')
        assert 'CONFLICT_1' in resolutions

        # Step 4: Reassemble
        result = reassemble_with_resolutions(file_with_conflict, conflicts, resolutions)

        # Verify result
        assert '<<<<<<' not in result
        assert 'merged: main + feature' in result
        assert 'import os' in result
        assert 'def bar():' in result

    def test_full_flow_preserves_structure(self):
        """Full flow preserves file structure outside conflicts."""
        file_with_conflict = '''# Header comment
"""Module docstring."""

import os
import sys

<<<<<<< HEAD
CONFIG = {"version": "1.0"}
=======
CONFIG = {"version": "2.0", "new_key": "value"}
>>>>>>> feature

def main():
    """Main function."""
    print(CONFIG)

if __name__ == "__main__":
    main()
'''
        conflicts, _ = parse_conflict_markers(file_with_conflict)

        ai_response = '''--- CONFLICT_1 RESOLVED ---
```python
CONFIG = {"version": "2.0", "new_key": "value", "merged": True}
```
'''
        resolutions = extract_conflict_resolutions(ai_response, conflicts, 'python')
        result = reassemble_with_resolutions(file_with_conflict, conflicts, resolutions)

        # All original structure preserved
        assert '# Header comment' in result
        assert '"""Module docstring."""' in result
        assert 'import os' in result
        assert 'import sys' in result
        assert 'def main():' in result
        assert 'if __name__ == "__main__":' in result
        # Resolution applied
        assert '"merged": True' in result
        # No conflict markers
        assert '<<<<<<' not in result
