# ProjectSettings Refactoring

This directory contains the refactored components from the original 1,445-line `ProjectSettings.tsx` file. The refactoring improves code maintainability, reusability, and testability by breaking down the monolithic component into smaller, focused modules.

## Architecture Overview

### Original Structure
- **Single file**: 1,445 lines
- **Multiple concerns**: State management, UI rendering, API calls, and business logic all mixed
- **Hard to maintain**: Complex component with many responsibilities
- **Difficult to test**: Tightly coupled logic

### New Structure
- **Modular approach**: Split into 17+ files
- **Separation of concerns**: Custom hooks, section components, and utility components
- **Easier to maintain**: Each file has a single, clear responsibility
- **Testable**: Individual components and hooks can be tested in isolation

## Directory Structure

```
project-settings/
├── README.md                         # This file
├── index.ts                          # Barrel export for all components
├── AutoBuildIntegration.tsx          # Auto-Build setup and status
├── ClaudeAuthSection.tsx             # Claude authentication configuration
├── LinearIntegrationSection.tsx      # Linear project management integration
├── GitHubIntegrationSection.tsx      # GitHub issues integration
├── MemoryBackendSection.tsx          # Graphiti/file-based memory configuration
├── AgentConfigSection.tsx            # Agent model selection
├── NotificationsSection.tsx          # Notification preferences
├── CollapsibleSection.tsx            # Reusable collapsible section wrapper
├── PasswordInput.tsx                 # Reusable password input with toggle
├── StatusBadge.tsx                   # Reusable status badge component
├── ConnectionStatus.tsx              # Reusable connection status display
└── InfrastructureStatus.tsx          # LadybugDB memory status display

hooks/
├── index.ts                          # Barrel export for all hooks
├── useProjectSettings.ts             # Project settings state management
├── useEnvironmentConfig.ts           # Environment configuration state
├── useClaudeAuth.ts                  # Claude authentication status
├── useLinearConnection.ts            # Linear connection status
├── useGitHubConnection.ts            # GitHub connection status
└── useInfrastructureStatus.ts        # LadybugDB memory status
```

## Component Breakdown

### Section Components (Feature-Specific)

#### AutoBuildIntegration.tsx
**Purpose**: Manages Auto-Build framework initialization and status.
**Props**:
- `autoBuildPath`: Current Auto-Build path
- `versionInfo`: Version and initialization status
- `isCheckingVersion`: Loading state
- `isUpdating`: Update in progress state
- `onInitialize`: Initialize Auto-Build handler
- `onUpdate`: Update Auto-Build handler

**Responsibilities**:
- Display initialization status
- Show Auto-Build version information
- Handle initialization and updates

#### ClaudeAuthSection.tsx
**Purpose**: Manages Claude Code authentication configuration.
**Props**:
- `isExpanded`: Section expand/collapse state
- `onToggle`: Toggle handler
- `envConfig`: Environment configuration
- `isLoadingEnv`: Loading state
- `envError`: Error message
- `isCheckingAuth`: Auth check in progress
- `authStatus`: Current authentication status
- `onClaudeSetup`: OAuth setup handler
- `onUpdateConfig`: Configuration update handler

**Responsibilities**:
- Display Claude CLI authentication status
- Manage OAuth token configuration
- Handle global vs project-specific tokens

#### LinearIntegrationSection.tsx
**Purpose**: Configures Linear project management integration.
**Props**:
- `isExpanded`: Section expand/collapse state
- `onToggle`: Toggle handler
- `envConfig`: Environment configuration
- `onUpdateConfig`: Configuration update handler
- `linearConnectionStatus`: Connection status
- `isCheckingLinear`: Connection check in progress
- `onOpenImportModal`: Import modal handler

**Responsibilities**:
- Enable/disable Linear integration
- Configure Linear API credentials
- Display connection status
- Manage real-time sync settings
- Handle task import from Linear

#### GitHubIntegrationSection.tsx
**Purpose**: Configures GitHub issues integration.
**Props**:
- `isExpanded`: Section expand/collapse state
- `onToggle`: Toggle handler
- `envConfig`: Environment configuration
- `onUpdateConfig`: Configuration update handler
- `gitHubConnectionStatus`: Connection status
- `isCheckingGitHub`: Connection check in progress

**Responsibilities**:
- Enable/disable GitHub integration
- Configure GitHub PAT and repository
- Display connection status
- Manage auto-sync settings

#### MemoryBackendSection.tsx
**Purpose**: Configures memory backend (Graphiti vs file-based).
**Props**:
- `isExpanded`: Section expand/collapse state
- `onToggle`: Toggle handler
- `envConfig`: Environment configuration
- `settings`: Project settings
- `onUpdateConfig`: Configuration update handler
- `onUpdateSettings`: Settings update handler
- `infrastructureStatus`: LadybugDB memory status
- Infrastructure management handlers

**Responsibilities**:
- Toggle between Graphiti and file-based memory
- Configure LLM and embedding providers
- Manage LadybugDB connection settings
- Display infrastructure status (LadybugDB)
- Handle infrastructure startup

#### AgentConfigSection.tsx
**Purpose**: Configures agent model selection.
**Props**:
- `settings`: Project settings
- `onUpdateSettings`: Settings update handler

**Responsibilities**:
- Display available models
- Handle model selection

#### NotificationsSection.tsx
**Purpose**: Configures notification preferences.
**Props**:
- `settings`: Project settings
- `onUpdateSettings`: Settings update handler

**Responsibilities**:
- Toggle task completion notifications
- Toggle task failure notifications
- Toggle review needed notifications
- Toggle sound notifications

### Utility Components (Reusable UI)

#### CollapsibleSection.tsx
**Purpose**: Reusable wrapper for collapsible sections.
**Props**:
- `title`: Section title
- `icon`: Section icon
- `isExpanded`: Expanded state
- `onToggle`: Toggle handler
- `badge`: Optional status badge
- `children`: Section content

**Usage**: Used by all integration sections for consistent expand/collapse behavior.

#### PasswordInput.tsx
**Purpose**: Reusable password input with show/hide toggle.
**Props**:
- `value`: Input value
- `onChange`: Change handler
- `placeholder`: Placeholder text
- `className`: Optional CSS class

**Usage**: Used for all sensitive credentials (OAuth tokens, API keys, passwords).

#### StatusBadge.tsx
**Purpose**: Reusable status badge component.
**Props**:
- `status`: 'success' | 'warning' | 'info'
- `label`: Badge text

**Usage**: Used to display connection status, enabled/disabled state, etc.

#### ConnectionStatus.tsx
**Purpose**: Reusable connection status display.
**Props**:
- `isChecking`: Loading state
- `isConnected`: Connection state
- `title`: Status title
- `successMessage`: Message when connected
- `errorMessage`: Message when not connected
- `additionalInfo`: Optional extra information

**Usage**: Used by Linear and GitHub sections to display connection status.

#### InfrastructureStatus.tsx
**Purpose**: Displays LadybugDB memory status for Graphiti.
**Props**:
- `infrastructureStatus`: Status object
- `isCheckingInfrastructure`: Loading state
- Infrastructure action handlers

**Usage**: Used by MemoryBackendSection to manage Graphiti infrastructure.

## Custom Hooks

### useProjectSettings.ts
**Purpose**: Manages project settings state and version checking.
**Returns**:
- `settings`: Current project settings
- `setSettings`: Settings updater
- `versionInfo`: Auto-Build version info
- `setVersionInfo`: Version info updater
- `isCheckingVersion`: Loading state

### useEnvironmentConfig.ts
**Purpose**: Manages environment configuration state and persistence.
**Returns**:
- `envConfig`: Current environment config
- `setEnvConfig`: Config updater
- `updateEnvConfig`: Partial update function (auto-saves to backend)
- `isLoadingEnv`: Loading state
- `envError`: Error state

### useClaudeAuth.ts
**Purpose**: Manages Claude authentication status checking.
**Returns**:
- `isCheckingClaudeAuth`: Loading state
- `claudeAuthStatus`: Authentication status
- `handleClaudeSetup`: OAuth setup handler

### useLinearConnection.ts
**Purpose**: Monitors Linear connection status.
**Returns**:
- `linearConnectionStatus`: Connection status object
- `isCheckingLinear`: Loading state

### useGitHubConnection.ts
**Purpose**: Monitors GitHub connection status.
**Returns**:
- `gitHubConnectionStatus`: Connection status object
- `isCheckingGitHub`: Loading state

### useInfrastructureStatus.ts
**Purpose**: Monitors LadybugDB memory infrastructure status.
**Returns**:
- `infrastructureStatus`: Status object
- `isCheckingInfrastructure`: Loading state
- Infrastructure management functions

## Main Component (ProjectSettings.tsx)

The refactored main component is now only **~320 lines** (down from 1,445), focusing on:
- Orchestrating child components
- Managing dialog state
- Coordinating save operations
- Handling component composition

## Benefits of This Refactoring

1. **Maintainability**: Each file has a clear, single responsibility
2. **Reusability**: Utility components can be used in other parts of the app
3. **Testability**: Individual components and hooks can be tested in isolation
4. **Readability**: Smaller files are easier to understand
5. **Type Safety**: Explicit prop interfaces improve TypeScript coverage
6. **Performance**: Can optimize individual components without affecting others
7. **Collaboration**: Multiple developers can work on different sections simultaneously

## Migration Guide

The refactored component maintains the same external API:

```tsx
// Usage remains the same
<ProjectSettings
  project={project}
  open={isOpen}
  onOpenChange={setIsOpen}
/>
```

All functionality is preserved - this is a pure refactor with no breaking changes.

## Future Improvements

Potential enhancements for the future:
1. Add unit tests for each component and hook
2. Add Storybook stories for visual testing
3. Extract common patterns into additional shared components
4. Add error boundary components
5. Implement optimistic updates for better UX
6. Add analytics tracking for user interactions
