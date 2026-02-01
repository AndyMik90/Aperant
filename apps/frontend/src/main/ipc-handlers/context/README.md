# Context Handlers Module

This directory contains the refactored context-related IPC handlers for the Jerry UI application. The handlers manage project context, memory systems (both file-based and Graphiti/LadybugDB), and project index operations.

## Architecture

The module is organized into focused, single-responsibility files:

### Core Modules

#### `utils.ts` (148 lines)
Shared utility functions for environment configuration and parsing.

**Exports:**
- `getAutoBuildSourcePath()` - Get auto-build source path from settings
- `parseEnvFile(content)` - Parse .env file content into key-value pairs
- `loadProjectEnvVars(projectPath, autoBuildPath)` - Load project-specific environment variables
- `loadGlobalSettings()` - Load global application settings
- `isGraphitiEnabled(projectEnvVars)` - Check if Graphiti memory system is enabled
- `hasOpenAIKey(projectEnvVars, globalSettings)` - Check if OpenAI API key is available
- `getGraphitiConnectionDetails(projectEnvVars)` - Get LadybugDB connection configuration

**Types:**
- `EnvironmentVars` - Environment variable dictionary
- `GlobalSettings` - Global application settings
- `GraphitiConnectionDetails` - LadybugDB connection details

#### `memory-status-handlers.ts` (130 lines)
Handlers for checking Graphiti/memory system configuration status.

**Exports:**
- `loadGraphitiStateFromSpecs(projectPath, autoBuildPath)` - Load Graphiti state from most recent spec
- `buildMemoryStatus(projectPath, autoBuildPath, memoryState)` - Build memory status from environment
- `registerMemoryStatusHandlers(getMainWindow)` - Register IPC handlers

**IPC Channels:**
- `CONTEXT_MEMORY_STATUS` - Get memory system status

#### `memory-data-handlers.ts` (242 lines)
Handlers for retrieving and searching memories (both file-based and LadybugDB).

**Exports:**
- `loadFileBasedMemories(specsDir, limit)` - Load memories from spec files
- `searchFileBasedMemories(specsDir, query, limit)` - Search file-based memories
- `registerMemoryDataHandlers(getMainWindow)` - Register IPC handlers

**IPC Channels:**
- `CONTEXT_GET_MEMORIES` - Get recent memories (with LadybugDB fallback)
- `CONTEXT_SEARCH_MEMORIES` - Search memories by query

**Features:**
- Dual-source memory loading (LadybugDB primary, file-based fallback)
- Session insights extraction from spec directories
- Codebase map integration
- Semantic search support (when Graphiti is available)

#### `project-context-handlers.ts` (199 lines)
Handlers for project context and index operations.

**Exports:**
- `registerProjectContextHandlers(getMainWindow)` - Register IPC handlers

**IPC Channels:**
- `CONTEXT_GET` - Get full project context (index, memory status, recent memories)
- `CONTEXT_REFRESH_INDEX` - Refresh project index by running analyzer

**Features:**
- Project index loading and caching
- Graphiti state detection from specs
- Memory status aggregation
- Analyzer script execution for index regeneration

#### `index.ts` (21 lines)
Main entry point that aggregates all context handlers.

**Exports:**
- `registerContextHandlers(getMainWindow)` - Register all context-related handlers
- Re-exports all utility functions and handler functions

## Refactoring Benefits

### Before (676 lines in single file)
- All context logic in one large file
- Difficult to navigate and maintain
- Repeated code for environment parsing
- Hard to test individual components
- No clear separation of concerns

### After (29 lines main + 740 lines in 5 focused modules)
- **Single Responsibility**: Each module has one clear purpose
- **Reusability**: Utility functions can be imported and tested independently
- **Maintainability**: Easier to find and fix issues in specific areas
- **Testability**: Each module can be unit tested in isolation
- **Readability**: Clear module boundaries with descriptive names
- **Scalability**: Easy to add new handlers without cluttering existing files

## Module Dependencies

```
context-handlers.ts (main entry)
    ↓
context/index.ts (aggregator)
    ↓
    ├── utils.ts (no dependencies, pure utilities)
    ├── memory-status-handlers.ts (depends on: utils)
    ├── memory-data-handlers.ts (depends on: utils, ladybug-service)
    └── project-context-handlers.ts (depends on: utils, memory-status-handlers, memory-data-handlers)
```

## Usage Example

```typescript
import { registerContextHandlers } from './ipc-handlers/context-handlers';

// In main process setup
const getMainWindow = () => mainWindow;
registerContextHandlers(getMainWindow);
```

## Testing Strategy

Each module can be tested independently:

```typescript
// Example: Testing utility functions
import { parseEnvFile, isGraphitiEnabled } from './utils';

test('parseEnvFile handles quotes correctly', () => {
  const content = 'API_KEY="test-key"\nDEBUG=true';
  const vars = parseEnvFile(content);
  expect(vars.API_KEY).toBe('test-key');
  expect(vars.DEBUG).toBe('true');
});

// Example: Testing memory status
import { buildMemoryStatus } from './memory-status-handlers';

test('buildMemoryStatus returns correct status', () => {
  const status = buildMemoryStatus('/path/to/project', 'auto-claude');
  expect(status).toHaveProperty('enabled');
  expect(status).toHaveProperty('available');
});
```

## Future Enhancements

- Add TypeScript interface documentation for all data structures
- Implement caching layer for frequently accessed context data
- Add telemetry for memory system performance
- Support additional memory providers beyond LadybugDB
- Implement memory compression for large session insights

## Related Documentation

- [Project Memory System](../../../../auto-claude/memory.py)
- [Graphiti Memory Integration](../../../../auto-claude/graphiti_memory.py)
- [LadybugDB Integration](../../ladybug-service.ts)
- [IPC Channels](../../../shared/constants.ts)
