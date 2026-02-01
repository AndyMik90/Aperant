# Task Logger Package

A modular, well-organized logging system for Jerry tasks with persistent storage and real-time UI updates.

## Package Structure

```
task_logger/
├── __init__.py          # Package exports and public API
├── models.py            # Data models (LogPhase, LogEntryType, LogEntry, PhaseLog)
├── logger.py            # Main TaskLogger class
├── storage.py           # Log persistence and file I/O
├── streaming.py         # Streaming marker emission for UI updates
├── utils.py             # Utility functions (get_task_logger, etc.)
├── capture.py           # StreamingLogCapture for agent sessions
└── README.md            # This file
```

## Modules

### models.py
Contains the core data models:
- `LogPhase`: Enum for execution phases (PLANNING, CODING, VALIDATION)
- `LogEntryType`: Enum for log entry types (TEXT, TOOL_START, TOOL_END, etc.)
- `LogEntry`: Dataclass representing a single log entry
- `PhaseLog`: Dataclass representing logs for a single phase

### logger.py
Main logging implementation:
- `TaskLogger`: Primary class for task logging with phase management, tool tracking, and event logging

### storage.py
Persistent storage functionality:
- `LogStorage`: Handles JSON file storage and retrieval
- `load_task_logs()`: Load logs from a spec directory
- `get_active_phase()`: Get currently active phase

### streaming.py
Real-time UI updates:
- `emit_marker()`: Emit streaming markers to stdout for UI consumption

### utils.py
Convenience utilities:
- `get_task_logger()`: Get or create global logger instance
- `clear_task_logger()`: Clear global logger
- `update_task_logger_path()`: Update logger path after directory rename

### capture.py
Agent session integration:
- `StreamingLogCapture`: Context manager for capturing agent output and logging it

## Usage

### Basic Usage

```python
from task_logger import TaskLogger, LogPhase

# Create logger for a spec
logger = TaskLogger(spec_dir)

# Start a phase
logger.start_phase(LogPhase.CODING, "Beginning implementation")

# Log messages
logger.log("Implementing feature X...")
logger.log_info("Processing file: app.py")
logger.log_success("Feature X completed!")
logger.log_error("Failed to process file")

# Track tool usage
logger.tool_start("Read", "/path/to/file.py")
logger.tool_end("Read", success=True, result="File read successfully")

# End phase
logger.end_phase(LogPhase.CODING, success=True)
```

### Using Global Logger

```python
from task_logger import get_task_logger

# Get/create global logger
logger = get_task_logger(spec_dir)
logger.log("Using global logger instance")
```

### Capturing Agent Output

```python
from task_logger import StreamingLogCapture, LogPhase

with StreamingLogCapture(logger, LogPhase.CODING) as capture:
    async for msg in client.receive_response():
        capture.process_message(msg)
```

### Loading Logs

```python
from task_logger import load_task_logs, get_active_phase

# Load all logs
logs = load_task_logs(spec_dir)

# Get active phase
active = get_active_phase(spec_dir)
```

## Design Principles

### Separation of Concerns
- **Models**: Pure data structures with no business logic
- **Storage**: File I/O and persistence isolated from logging logic
- **Logger**: Business logic for logging operations
- **Streaming**: UI update mechanism separated from core logging
- **Utils**: Helper functions for common patterns
- **Capture**: Agent integration separated from core logger

### Backwards Compatibility
The refactored package maintains 100% backwards compatibility. All existing imports continue to work:

```python
# These imports still work (re-exported from task_logger.py)
from task_logger import LogPhase, TaskLogger, get_task_logger
```

### Type Hints
All functions and classes include comprehensive type hints for better IDE support and code clarity.

### Testability
Each module has a single responsibility, making it easier to test individual components.

## Migration Guide

**No migration needed!** The refactoring maintains full backwards compatibility.

Existing code continues to work without changes:
```python
from task_logger import LogPhase, TaskLogger, get_task_logger
```

New code can import from specific modules if desired:
```python
from task_logger.models import LogPhase
from task_logger.logger import TaskLogger
from task_logger.utils import get_task_logger
```

## Benefits of Refactoring

1. **Improved Maintainability**: 52-line entry point vs. 818-line monolith
2. **Clear Separation**: Each module has a single, well-defined purpose
3. **Better Testing**: Isolated modules are easier to unit test
4. **Enhanced Readability**: Easier to find and understand specific functionality
5. **Scalability**: New features can be added to appropriate modules
6. **No Breaking Changes**: Full backwards compatibility maintained
