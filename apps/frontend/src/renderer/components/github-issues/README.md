# GitHub Issues Module

A well-structured, modular implementation of the GitHub Issues feature for the Auto Claude UI.

## Quick Stats

- **Main Component:** 131 lines (down from 623 lines - 79% reduction)
- **Total Modules:** 14 files organized in 4 directories
- **Custom Hooks:** 3 reusable hooks
- **UI Components:** 7 focused components
- **Type Definitions:** 11 TypeScript interfaces
- **Utility Functions:** 2 helper functions

## Directory Structure

```
github-issues/
├── components/           # UI Components (7 components, 507 lines)
├── hooks/                # Custom Hooks (3 hooks, 143 lines)
├── types/                # TypeScript Types (65 lines)
├── utils/                # Utilities (21 lines)
├── index.ts              # Module exports
├── README.md             # This file
├── REFACTORING_SUMMARY.md
└── ARCHITECTURE.md
```

## Usage

### Basic Import
```typescript
// Import the main component
import { GitHubIssues } from './components/github-issues';

// Use in your app
<GitHubIssues onOpenSettings={handleOpenSettings} />
```

### Advanced Usage
```typescript
// Import specific components for custom layouts
import {
  IssueList,
  IssueDetail,
  InvestigationDialog
} from './components/github-issues';

// Import hooks for custom implementations
import {
  useGitHubIssues,
  useGitHubInvestigation
} from './components/github-issues';

// Import types for type safety
import type {
  GitHubIssuesProps,
  FilterState
} from './components/github-issues';

// Import utilities
import { formatDate, filterIssuesBySearch } from './components/github-issues';
```

## Modules

### Components (`/components`)

| Component | Lines | Purpose |
|-----------|-------|---------|
| **IssueListItem** | 67 | Individual issue card with metadata and investigate button |
| **IssueList** | 53 | Container for issue list with loading/error/empty states |
| **IssueListHeader** | 80 | Header with search, filters, refresh controls |
| **IssueDetail** | 162 | Full issue detail view with description, labels, etc |
| **InvestigationDialog** | 107 | Modal for AI investigation with progress tracking |
| **EmptyStates** | 38 | Reusable empty state and not-connected state components |

### Hooks (`/hooks`)

| Hook | Lines | Purpose |
|------|-------|---------|
| **useGitHubIssues** | 53 | Manages issue loading, filtering, and state |
| **useGitHubInvestigation** | 70 | Handles AI investigation lifecycle and events |
| **useIssueFiltering** | 17 | Provides search functionality with memoization |

### Types (`/types`)

Centralized TypeScript definitions for:
- Component props interfaces
- FilterState type ('open' | 'closed' | 'all')
- Event handler signatures
- Investigation status types

### Utils (`/utils`)

| Function | Purpose |
|----------|---------|
| **formatDate** | Formats ISO date strings to readable format |
| **filterIssuesBySearch** | Filters issues by search query |

## Features

### Issue Management
- View GitHub issues synced from repository
- Filter by state (open/closed/all)
- Search issues by title and body
- Select issues to view details
- Refresh issue list

### AI Investigation
- Investigate issues with AI analysis
- Create tasks from GitHub issues
- Track investigation progress
- View investigation results
- Complexity estimation

### UI/UX
- Split-pane layout (list + detail)
- Loading and error states
- Empty states
- Responsive design
- Smooth transitions

## Architecture

The module follows a clean architecture with clear separation of concerns:

1. **Presentation Layer** (`/components`) - Pure UI components
2. **Business Logic Layer** (`/hooks`) - Reusable hooks with state management
3. **Type Layer** (`/types`) - TypeScript definitions
4. **Utility Layer** (`/utils`) - Pure helper functions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## State Management

The module uses a hybrid state management approach:

- **Zustand Store** (`useGitHubStore`) - Shared state across the app
- **Custom Hooks** - Encapsulated business logic and side effects
- **Local State** - Component-specific UI state

## Dependencies

### Internal Dependencies
- `../stores/github-store` - GitHub state management
- `../stores/project-store` - Project state management
- `../../shared/types` - Shared TypeScript types
- `../../shared/constants` - Shared constants

### External Dependencies
- React (hooks: useState, useEffect, useCallback, useMemo)
- lucide-react (icons)
- UI components (button, input, badge, card, etc.)

## Development

### Adding a New Component

1. Create component file in `/components/ComponentName.tsx`
2. Define props interface in `/types/index.ts`
3. Export component from `/components/index.ts`
4. Import and use in main component

### Adding a New Hook

1. Create hook file in `/hooks/useHookName.ts`
2. Define types in `/types/index.ts` if needed
3. Export hook from `/hooks/index.ts`
4. Use in components

### Adding a New Utility

1. Create utility function in `/utils/index.ts`
2. Keep it pure (no side effects)
3. Add types for parameters and return values
4. Export from `/utils/index.ts`

## Testing Strategy

### Component Testing
```typescript
// Test components in isolation
import { render, screen } from '@testing-library/react';
import { IssueListItem } from './components';

test('renders issue title', () => {
  render(<IssueListItem issue={mockIssue} {...props} />);
  expect(screen.getByText('Issue Title')).toBeInTheDocument();
});
```

### Hook Testing
```typescript
// Test hooks with renderHook
import { renderHook } from '@testing-library/react-hooks';
import { useGitHubIssues } from './hooks';

test('loads issues on mount', () => {
  const { result } = renderHook(() => useGitHubIssues('project-id'));
  expect(result.current.isLoading).toBe(true);
});
```

### Util Testing
```typescript
// Test utilities as pure functions
import { formatDate } from './utils';

test('formats date correctly', () => {
  expect(formatDate('2024-01-01')).toBe('Jan 1, 2024');
});
```

## Performance Considerations

### Optimizations Implemented
- **Memoization** - useIssueFiltering uses useMemo for filtered results
- **Callback Memoization** - useCallback for event handlers
- **Virtual Scrolling** - ScrollArea component for long lists
- **Lazy Loading** - Components only render when needed

### Future Optimizations
- Implement React.memo for expensive components
- Add pagination for large issue lists
- Use React Query for better caching
- Add intersection observer for lazy image loading

## Troubleshooting

### Common Issues

**Issue: Components not rendering**
- Check that all required props are passed
- Verify that the GitHub store is properly initialized
- Check browser console for TypeScript errors

**Issue: Issues not loading**
- Verify GitHub token is configured
- Check project settings for repository URL
- Inspect network tab for API errors

**Issue: Investigation not working**
- Ensure project is selected
- Check that the investigation service is running
- Verify event listeners are properly set up

## Migration from Original Component

The refactored module maintains 100% backward compatibility:

```typescript
// Old import (still works)
import { GitHubIssues } from './components/GitHubIssues';

// New import (recommended)
import { GitHubIssues } from './components/github-issues';

// Both work exactly the same way
<GitHubIssues onOpenSettings={handler} />
```

## Documentation

- **README.md** (this file) - Module overview and usage
- **REFACTORING_SUMMARY.md** - Detailed refactoring metrics and benefits
- **ARCHITECTURE.md** - In-depth architecture documentation

## Contributing

When contributing to this module:

1. Follow the established file structure
2. Keep components small and focused (< 200 lines)
3. Use TypeScript strictly (no `any` types)
4. Add proper prop interfaces
5. Document complex logic with comments
6. Write tests for new features
7. Update documentation as needed

## License

Part of the Jerry project.
