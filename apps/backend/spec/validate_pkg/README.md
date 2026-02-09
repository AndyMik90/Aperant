# Spec Validation System

A modular validation framework for validating spec outputs at each checkpoint.

## Architecture

The validation system has been refactored into a clean, modular structure with clear separation of concerns:

```
validate_spec/
├── __init__.py                 # Package exports
├── models.py                   # ValidationResult dataclass
├── schemas.py                  # Schema definitions and constants
├── auto_fix.py                 # Auto-fix utilities
├── spec_validator.py           # Main orchestrator
└── validators/                 # Individual checkpoint validators
    ├── __init__.py
    ├── prereqs_validator.py
    ├── context_validator.py
    ├── spec_document_validator.py
    └── implementation_plan_validator.py
```

## Components

### Models (`models.py`)
- **ValidationResult**: Data class representing validation results with errors, warnings, and suggested fixes

### Schemas (`schemas.py`)
- **IMPLEMENTATION_PLAN_SCHEMA**: Schema for implementation_plan.json
- **CONTEXT_SCHEMA**: Schema for context.json
- **PROJECT_INDEX_SCHEMA**: Schema for project_index.json
- **SPEC_REQUIRED_SECTIONS**: Required sections in spec.md
- **SPEC_RECOMMENDED_SECTIONS**: Recommended sections in spec.md

### Validators (`validators/`)

Each validator is responsible for a specific checkpoint:

#### PrereqsValidator
Validates that required prerequisites exist:
- Spec directory exists
- project_index.json exists

#### ContextValidator
Validates context.json structure:
- File exists and is valid JSON
- Contains required fields (task_description)
- Warns about missing recommended fields

#### SpecDocumentValidator
Validates spec.md document:
- File exists
- Contains required sections (Overview, Workflow Type, Task Scope, Success Criteria)
- Warns about missing recommended sections
- Checks minimum content length

#### ImplementationPlanValidator
Validates implementation_plan.json:
- File exists and is valid JSON
- Contains required top-level fields
- Valid workflow_type
- Phases have correct structure
- Subtasks have correct structure
- No circular dependencies

### Auto-Fix (`auto_fix.py`)
Automated fixes for common issues:
- Adds missing required fields to implementation_plan.json
- Fixes missing phase/subtask IDs
- Sets default status values

### Main Validator (`spec_validator.py`)
Orchestrates all validation checkpoints:
- Initializes individual validators
- Provides unified interface
- Runs validation for specific checkpoints or all at once

## Usage

### Python API

```python
from validate_spec import SpecValidator, auto_fix_plan
from pathlib import Path

# Create validator
spec_dir = Path("ac-jerry/specs/001-feature")
validator = SpecValidator(spec_dir)

# Validate specific checkpoint
result = validator.validate_context()
if not result.valid:
    print(f"Errors: {result.errors}")
    print(f"Suggested fixes: {result.fixes}")

# Validate all checkpoints
results = validator.validate_all()
all_valid = all(r.valid for r in results)

# Auto-fix common issues
if auto_fix_plan(spec_dir):
    print("Auto-fixed implementation plan")
```

### CLI

```bash
# Validate all checkpoints
python ac-jerry/validate_spec.py --spec-dir ac-jerry/specs/001-feature/ --checkpoint all

# Validate specific checkpoint
python ac-jerry/validate_spec.py --spec-dir ac-jerry/specs/001-feature/ --checkpoint context

# Auto-fix and validate
python ac-jerry/validate_spec.py --spec-dir ac-jerry/specs/001-feature/ --auto-fix --checkpoint plan

# JSON output
python ac-jerry/validate_spec.py --spec-dir ac-jerry/specs/001-feature/ --checkpoint all --json
```

## Imports

### From Other Modules

Other modules should import from the package:

```python
# Correct
from validate_spec import SpecValidator, ValidationResult, auto_fix_plan
from validate_spec.spec_validator import SpecValidator

# Avoid (internal implementation details)
from validate_spec.validators.context_validator import ContextValidator
```

## Benefits of Refactoring

### Before
- Single 633-line file
- All logic mixed together
- Hard to maintain and extend
- Difficult to test individual components

### After
- Main entry point: 109 lines (83% reduction)
- Clear separation of concerns
- Each validator is independent and testable
- Easy to add new validators
- Schemas centralized and reusable
- Better code organization and discoverability

## Testing

Each validator can be tested independently:

```python
from validate_spec.validators import ContextValidator
from pathlib import Path

validator = ContextValidator(Path("specs/001-feature"))
result = validator.validate()
assert result.valid
```

## Extension

To add a new checkpoint validator:

1. Create a new validator in `validators/`:
```python
# validators/new_checkpoint_validator.py
from pathlib import Path
from ..models import ValidationResult

class NewCheckpointValidator:
    def __init__(self, spec_dir: Path):
        self.spec_dir = Path(spec_dir)

    def validate(self) -> ValidationResult:
        # Validation logic here
        return ValidationResult(True, "new_checkpoint", [], [], [])
```

2. Add to `validators/__init__.py`:
```python
from .new_checkpoint_validator import NewCheckpointValidator
__all__ = [..., "NewCheckpointValidator"]
```

3. Add method to `SpecValidator`:
```python
def validate_new_checkpoint(self) -> ValidationResult:
    validator = NewCheckpointValidator(self.spec_dir)
    return validator.validate()
```

4. Update CLI in main `validate_spec.py` if needed
