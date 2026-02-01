# IPC Handlers - Modular Architecture

This directory contains the refactored IPC (Inter-Process Communication) handlers for Jerry UI, organized into domain-specific modules for better maintainability and code organization.

## Overview

The original monolithic `ipc-handlers.ts` file (6,913 lines, 220KB) has been refactored into 16 focused modules, each handling a specific domain of the application.

## Module Structure

### Core Modules

#### `project-handlers.ts` (10KB)
Handles project lifecycle and Python environment management:
- `PROJECT_ADD` - Add new project to workspace
- `PROJECT_REMOVE` - Remove project
- `PROJECT_LIST` - List all projects
- `PROJECT_UPDATE_SETTINGS` - Update project settings
- `PROJECT_INITIALIZE` - Initialize .auto-claude directory
- `PROJECT_CHECK_VERSION` - Check initialization status
- `project:has-local-source` - Check if project has local auto-claude source
- Python environment initialization and status events

#### `task-handlers.ts` (52KB) - Largest module
Manages task lifecycle and execution:
- `TASK_LIST` - List tasks for project
- `TASK_CREATE` - Create new task with auto-generated title
- `TASK_DELETE` - Delete task
- `TASK_UPDATE` - Update task properties
- `TASK_START` - Start task execution
- `TASK_STOP` - Stop running task
- `TASK_REVIEW` - Review task results
- `TASK_UPDATE_STATUS` - Update task status
- `TASK_RECOVER_STUCK` - Recover stuck tasks
- `TASK_CHECK_RUNNING` - Check if task is running
- `TASK_ARCHIVE` / `TASK_UNARCHIVE` - Archive management
- Worktree operations (status, diff, merge, discard)
- Task logs (get, watch, unwatch)

#### `terminal-handlers.ts` (16KB)
Terminal and Claude profile management:
- `TERMINAL_CREATE` - Create terminal session
- `TERMINAL_DESTROY` - Destroy terminal
- `TERMINAL_INPUT` - Send input to terminal
- `TERMINAL_RESIZE` - Resize terminal
- `TERMINAL_INVOKE_CLAUDE` - Invoke Claude in terminal
- Claude profile management (CRUD operations)
- Profile auto-switching and usage tracking
- Terminal session persistence and restoration

#### `settings-handlers.ts` (6.3KB)
Application settings and dialogs:
- `SETTINGS_GET` - Get app settings
- `SETTINGS_SAVE` - Save app settings
- `DIALOG_SELECT_DIRECTORY` - Directory selection dialog
- `DIALOG_CREATE_PROJECT_FOLDER` - Create project folder
- `DIALOG_GET_DEFAULT_PROJECT_LOCATION` - Get default location
- `APP_VERSION` - Get application version

#### `file-handlers.ts` (2.0KB)
File system operations:
- `FILE_EXPLORER_LIST` - List directory contents with filtering

### Feature Modules

#### `roadmap-handlers.ts` (12KB)
Roadmap generation and management:
- `ROADMAP_GET` - Get project roadmap
- `ROADMAP_GENERATE` - Generate roadmap with AI
- `ROADMAP_REFRESH` - Refresh roadmap
- `ROADMAP_UPDATE_FEATURE` - Update feature status
- `ROADMAP_CONVERT_TO_SPEC` - Convert feature to task spec

#### `ideation-handlers.ts` (22KB)
AI-powered ideation system:
- `IDEATION_GET` - Get ideation session
- `IDEATION_GENERATE` - Generate ideas with AI
- `IDEATION_REFRESH` - Refresh ideas
- `IDEATION_STOP` - Stop generation
- `IDEATION_UPDATE_IDEA` - Update idea
- `IDEATION_CONVERT_TO_TASK` - Convert idea to task
- `IDEATION_DISMISS` / `IDEATION_DISMISS_ALL` - Dismiss ideas

#### `insights-handlers.ts` (9.4KB)
AI insights chat system:
- `INSIGHTS_GET_SESSION` - Get chat session
- `INSIGHTS_SEND_MESSAGE` - Send chat message
- `INSIGHTS_CLEAR_SESSION` - Clear session
- `INSIGHTS_CREATE_TASK` - Create task from insights
- Session management (list, new, switch, delete, rename)

#### `changelog-handlers.ts` (8.2KB)
Changelog generation:
- `CHANGELOG_GET_DONE_TASKS` - Get completed tasks
- `CHANGELOG_LOAD_TASK_SPECS` - Load task specifications
- `CHANGELOG_GENERATE` - Generate changelog with AI
- `CHANGELOG_SAVE` - Save changelog
- `CHANGELOG_READ_EXISTING` - Read existing changelog
- `CHANGELOG_SUGGEST_VERSION` - Suggest version number
- Git operations (branches, tags, commits)

#### `context-handlers.ts` (20KB)
Project context and memory:
- `CONTEXT_GET` - Get project context
- `CONTEXT_REFRESH_INDEX` - Refresh project index
- `CONTEXT_MEMORY_STATUS` - Get Graphiti memory status
- `CONTEXT_SEARCH_MEMORIES` - Search memory episodes
- `CONTEXT_GET_MEMORIES` - Get memory episodes

### Integration Modules

#### `github-handlers.ts` (23KB)
GitHub integration:
- `GITHUB_GET_REPOSITORIES` - List repositories
- `GITHUB_GET_ISSUES` - List issues
- `GITHUB_GET_ISSUE` - Get single issue
- `GITHUB_CHECK_CONNECTION` - Test connection
- `GITHUB_INVESTIGATE_ISSUE` - AI investigation
- `GITHUB_IMPORT_ISSUES` - Import issues as tasks
- `GITHUB_CREATE_RELEASE` - Create GitHub release

#### `linear-handlers.ts` (15KB)
Linear integration:
- `LINEAR_GET_TEAMS` - List teams
- `LINEAR_GET_PROJECTS` - List projects
- `LINEAR_GET_ISSUES` - List issues
- `LINEAR_IMPORT_ISSUES` - Import issues as tasks
- `LINEAR_CHECK_CONNECTION` - Test connection

#### `env-handlers.ts` (16KB)
Environment configuration:
- `ENV_GET` - Get project environment
- `ENV_UPDATE` - Update environment variables
- `ENV_CHECK_CLAUDE_AUTH` - Check Claude authentication
- `ENV_INVOKE_CLAUDE_SETUP` - Run Claude setup

#### `autobuild-source-handlers.ts` (8.9KB)
Auto-build source updates:
- `AUTOBUILD_SOURCE_CHECK` - Check for updates
- `AUTOBUILD_SOURCE_DOWNLOAD` - Download updates
- `AUTOBUILD_SOURCE_VERSION` - Get version info
- Source environment configuration

### Event Handlers

#### `agent-events-handlers.ts` (6.1KB)
Agent event forwarding to renderer:
- Agent log events
- Agent error events
- SDK rate limit events
- Agent exit events with status transitions
- Execution progress events
- File watcher events
- Implementation plan updates

## Entry Point

### `index.ts` (3.6KB)
Central registration point that:
- Imports all handler modules
- Exports `setupIpcHandlers()` function
- Configures services with dependencies
- Registers all handlers in organized sequence
- Re-exports individual registration functions

### Main IPC Handlers File
The refactored `ipc-handlers.ts` now:
- Imports `setupIpcHandlers` from `./ipc-handlers`
- Delegates all registration to modular handlers
- Provides clear documentation of module organization
- Reduced from 6,913 lines to ~50 lines

## Benefits of Modular Architecture

### Maintainability
- **Focused Modules**: Each module has a single responsibility
- **Clear Boundaries**: Domain separation makes code easier to understand
- **Reduced Complexity**: Smaller files are easier to navigate and modify
- **Better Organization**: Related handlers grouped together

### Testability
- **Isolated Testing**: Each module can be tested independently
- **Mock Dependencies**: Easier to mock services for unit tests
- **Focused Test Suites**: Test files can mirror module structure

### Developer Experience
- **Easier Navigation**: Find handlers by domain, not by scrolling
- **Reduced Conflicts**: Multiple developers can work on different modules
- **Clear Imports**: Each module declares its dependencies explicitly
- **Better IDE Support**: Faster intellisense and type checking

### Code Quality
- **Explicit Dependencies**: Each module imports only what it needs
- **Type Safety**: Proper TypeScript imports throughout
- **Consistent Patterns**: Uniform registration pattern across modules
- **Documentation**: Each module has clear purpose and scope

## Usage

To register all IPC handlers:

```typescript
import { setupIpcHandlers } from './ipc-handlers';
import { AgentManager } from './agent-manager';
import { TerminalManager } from './terminal-manager';
import { PythonEnvManager } from './python-env-manager';

// Initialize services
const agentManager = new AgentManager();
const terminalManager = new TerminalManager();
const pythonEnvManager = new PythonEnvManager();

// Register all handlers
setupIpcHandlers(
  agentManager,
  terminalManager,
  () => mainWindow,
  pythonEnvManager
);
```

To register individual modules:

```typescript
import { registerTaskHandlers } from './ipc-handlers/task-handlers';

registerTaskHandlers(agentManager, () => mainWindow);
```

## Migration Notes

The refactoring maintains 100% backward compatibility:
- All IPC channel names unchanged
- All handler signatures unchanged
- All service dependencies preserved
- Event forwarding logic unchanged

Original file backed up as `ipc-handlers.ts.backup`.

## Module Dependencies

Each module may depend on:
- **Services**: AgentManager, TerminalManager, ChangelogService, etc.
- **Stores**: projectStore
- **Utilities**: fileWatcher, titleGenerator
- **Constants**: IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir
- **Types**: Extensive TypeScript types from shared/types

All dependencies are explicitly imported at the module level.
