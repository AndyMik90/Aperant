# Insights Module

This directory contains the modular architecture for the AI-powered codebase insights feature.

## Architecture Overview

The insights module follows a clean separation of concerns with each module handling a specific responsibility:

```
insights-service.ts (186 lines)
├── config.ts (109 lines) - Configuration & Environment Management
├── paths.ts (46 lines) - Path Resolution Utilities
├── session-storage.ts (212 lines) - Filesystem Persistence
├── session-manager.ts (151 lines) - Session Lifecycle Management
└── insights-executor.ts (267 lines) - Python Process Execution
```

## Module Responsibilities

### InsightsConfig (`config.ts`)
- Manages Python and ac-jerry source path configuration
- Detects ac-jerry installation automatically
- Loads environment variables from ac-jerry .env file
- Provides complete process environment with profile support

### InsightsPaths (`paths.ts`)
- Provides consistent path resolution for insights data
- Manages session directory structure
- Handles migration paths for old session format

### SessionStorage (`session-storage.ts`)
- Handles filesystem persistence of sessions
- Loads and saves session JSON files
- Manages session file operations (create, read, update, delete)
- Handles old session format migration
- Generates session titles from first user message

### SessionManager (`session-manager.ts`)
- Manages in-memory session cache
- Coordinates session lifecycle operations
- Provides high-level session operations (create, switch, delete, rename)
- Manages current session pointer

### InsightsExecutor (`insights-executor.ts`)
- Spawns and manages Python insights_runner.py process
- Handles streaming output parsing
- Detects and emits tool usage events
- Detects and handles rate limiting
- Emits status updates and stream chunks

## Usage

The main `InsightsService` class (in `insights-service.ts`) coordinates all these modules:

```typescript
import { InsightsService } from './insights-service';

const service = new InsightsService();

// Configure paths
service.configure(pythonPath, autoBuildSourcePath);

// Load session
const session = service.loadSession(projectId, projectPath);

// Send message
await service.sendMessage(projectId, projectPath, message);
```

## Event Flow

1. User sends message via `sendMessage()`
2. Service loads/creates session via `SessionManager`
3. Service executes query via `InsightsExecutor`
4. Executor emits streaming events (status, chunks, tools)
5. Service saves assistant response via `SessionManager`

## Benefits of This Architecture

- **Maintainability**: Each module has a single, clear responsibility
- **Testability**: Modules can be unit tested independently
- **Reusability**: Modules can be used independently if needed
- **Readability**: Much easier to understand and navigate
- **Extensibility**: Easy to add new features to specific modules

## Migration Notes

This refactoring maintains 100% backward compatibility. All functionality from the original 659-line file is preserved, just better organized across 5 focused modules.
