# AI Resolver Module

## Overview

This module provides AI-based conflict resolution for the Jerry merge system. The code has been refactored from a single 665-line file into a well-organized package with clear separation of concerns.

## Architecture

### Module Structure

```
ai_resolver/
├── __init__.py           # Public API exports
├── resolver.py           # Core AIResolver class (406 lines)
├── context.py            # ConflictContext data model (75 lines)
├── prompts.py            # AI prompt templates (97 lines)
├── parsers.py            # Code block parsing (101 lines)
├── language_utils.py     # Language detection & location utils (70 lines)
└── claude_client.py      # Claude SDK integration (92 lines)
```

### Refactoring Results

- **Original file**: 665 lines in single ai_resolver.py
- **New main file**: 39 lines (compatibility layer)
- **Total new code**: 877 lines (includes better documentation and type hints)
- **Reduction in main file**: 94% smaller

### Design Principles

1. **Separation of Concerns**: Each module has a single, well-defined responsibility
2. **Backwards Compatibility**: Existing imports continue to work unchanged
3. **Type Safety**: Comprehensive type hints throughout
4. **Testability**: Smaller modules are easier to test in isolation
5. **Documentation**: Clear docstrings for all public APIs

## Module Responsibilities

### `resolver.py`
Core AIResolver class that orchestrates the resolution process:
- Builds conflict contexts
- Manages AI calls
- Resolves single and multiple conflicts
- Tracks usage statistics

### `context.py`
ConflictContext data model:
- Encapsulates minimal context for AI prompts
- Formats context for display
- Estimates token usage

### `prompts.py`
Prompt template management:
- System prompts
- Single conflict merge prompts
- Batch conflict merge prompts
- Formatting functions

### `parsers.py`
Code extraction utilities:
- Extract code blocks from AI responses
- Validate code-like content
- Handle batch responses

### `language_utils.py`
Language and location utilities:
- Infer programming language from file paths
- Check if code locations overlap

### `claude_client.py`
Claude SDK integration:
- Factory function for Claude-based resolver
- Async SDK client management
- Error handling and logging

## Usage

### Basic Usage

```python
from merge.ai_resolver import AIResolver, create_claude_resolver

# Create resolver with Claude integration
resolver = create_claude_resolver()

# Resolve a conflict
result = resolver.resolve_conflict(
    conflict=conflict_region,
    baseline_code=original_code,
    task_snapshots=snapshots
)
```

### Custom AI Function

```python
from merge.ai_resolver import AIResolver

def my_ai_function(system: str, user: str) -> str:
    # Your AI integration here
    return ai_response

resolver = AIResolver(ai_call_fn=my_ai_function)
```

### Batch Resolution

```python
# Resolve multiple conflicts efficiently
results = resolver.resolve_multiple_conflicts(
    conflicts=conflict_list,
    baseline_codes=baseline_dict,
    task_snapshots=all_snapshots,
    batch=True  # Enable batching for efficiency
)
```

## Benefits of Refactoring

1. **Maintainability**: Easier to understand and modify individual components
2. **Testability**: Each module can be tested independently
3. **Reusability**: Components like parsers and prompt formatters can be reused
4. **Extensibility**: Easy to add new AI providers or parsing strategies
5. **Code Quality**: Better organization leads to cleaner code
6. **Documentation**: Each module has focused documentation

## Backwards Compatibility

The refactoring maintains 100% backwards compatibility:

```python
# These imports still work exactly as before
from merge.ai_resolver import AIResolver, ConflictContext, create_claude_resolver
from merge import AIResolver, create_claude_resolver
```

All existing code using the ai_resolver module continues to work without modification.
