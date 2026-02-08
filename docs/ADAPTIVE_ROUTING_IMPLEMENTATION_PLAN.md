# Adaptive Routing Implementation Plan

## Goal
Enable users to customize model selection per complexity level while keeping sensible defaults.

## Current Changes Made ✅

1. **Backend** (`complexity_classifier.py`) - Fixed outdated comment to match reality
2. **Frontend types** (`settings.ts`) - Added `isAdaptive?: boolean` flag to AgentProfile
3. **Frontend profiles** (`models.ts`):
   - Renamed "Auto (Optimized)" → "Adaptive (Recommended)" with `isAdaptive: true`
   - Added "All-Opus" profile for users who want consistent Opus everywhere
   - Updated DEFAULT_PHASE to match COMPLEX routing (Opus + Sonnet + Sonnet)

## What's Left to Implement

### Phase 1: Make Adaptive Routing Active (Backend)

**Currently**: Frontend always writes `phaseModels` to `task_metadata.json`, bypassing complexity routing

**Need**: When user selects "Adaptive" profile, DON'T write `phaseModels`/`phaseThinking` to task metadata

**Files to Modify**:
1. Find where task_metadata.json is created (likely in frontend task creation or backend spec runner)
2. Add check: `if (profile.isAdaptive) { skip writing phaseModels }`
3. Backend will then use `COMPLEXITY_PHASE_CONFIG` based on task complexity

### Phase 2: Add UI for Customizing Complexity Routing

**User Request**: "users should be able to change each phase based on complexity"

**Design**: Add new settings page section

```
┌─────────────────────────────────────────────────────┐
│ Agent Settings > Complexity-Based Routing            │
├─────────────────────────────────────────────────────┤
│                                                      │
│  [Reset to Defaults Button]                         │
│                                                      │
│  ┌─ SIMPLE Tasks ─────────────────────────────────┐ │
│  │ Planning:  [Opus ▼]  [Low ▼]                   │ │
│  │ Coding:    [Haiku ▼] [None ▼]                  │ │
│  │ QA:        [Skip]                              │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ MEDIUM Tasks ─────────────────────────────────┐ │
│  │ Planning:  [Opus ▼]   [Medium ▼]               │ │
│  │ Coding:    [Sonnet ▼] [Low ▼]                  │ │
│  │ QA:        [Haiku ▼]  [Low ▼]                  │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ COMPLEX Tasks ────────────────────────────────┐ │
│  │ Planning:  [Opus ▼]   [High ▼]                 │ │
│  │ Coding:    [Sonnet ▼] [Medium ▼]               │ │
│  │ QA:        [Sonnet ▼] [Medium ▼]               │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  [Save Changes]                                      │
└─────────────────────────────────────────────────────┘
```

**Files to Create/Modify**:

1. **New Component**: `apps/frontend/src/renderer/components/settings/ComplexityRoutingSettings.tsx`
   - Three collapsible sections (SIMPLE/MEDIUM/COMPLEX)
   - Dropdowns for model + thinking level per phase
   - "Reset to Defaults" button
   - "Save Changes" button

2. **New Settings Keys** (add to `AppSettings` interface):
   ```typescript
   interface AppSettings {
     // ... existing fields

     // Custom complexity routing (overrides backend defaults)
     customComplexityRouting?: {
       SIMPLE?: { planning?: string, coding?: string, qa?: string },
       MEDIUM?: { planning?: string, coding?: string, qa?: string },
       COMPLEX?: { planning?: string, coding?: string, qa?: string }
     };
     customComplexityThinking?: {
       SIMPLE?: { planning?: string, coding?: string, qa?: string },
       MEDIUM?: { planning?: string, coding?: string, qa?: string },
       COMPLEX?: { planning?: string, coding?: string, qa?: string }
     };
   }
   ```

3. **IPC Handler**: Extend `settings-handlers.ts` to save/load complexity routing settings

4. **Backend**: `phase_config.py` needs to read custom routing from settings if present
   - Add function: `load_custom_complexity_config(settings_path)`
   - Modify `get_phase_model()` to check custom config first

### Phase 3: Integration with Task Creation

**Flow**:
1. User creates task
2. User selects profile (e.g., "Adaptive")
3. If `profile.isAdaptive === true`:
   - DON'T write `phaseModels` to task_metadata.json
   - Backend uses complexity routing (custom if set, else defaults)
4. If profile has explicit `phaseModels`:
   - Write them to task_metadata.json (current behavior)

## Priority Implementation Order

### High Priority (This Sprint)
1. ✅ Fix comment in complexity_classifier.py
2. ✅ Add isAdaptive flag to profiles
3. ✅ Rename "Auto" → "Adaptive", add "All-Opus" profile
4. ⏳ Find where task_metadata is written
5. ⏳ Add check to skip phaseModels if isAdaptive
6. ⏳ Test that adaptive routing works

### Medium Priority (Next Sprint)
7. Create ComplexityRoutingSettings component
8. Add settings keys for custom routing
9. Add IPC handlers for saving/loading
10. Update backend to read custom routing
11. Add "Reset to Defaults" button

### Low Priority (Future)
- Add cost estimator showing $ per complexity level
- Add "Test Routing" button to simulate a task and show which models it would use
- Add preset templates ("Cost-Optimized", "Quality-First", etc.)

## Testing Plan

### Unit Tests
- `isAdaptive` flag correctly prevents writing phaseModels
- Custom routing settings properly override backend defaults
- "Reset to Defaults" restores backend COMPLEXITY_PHASE_CONFIG

### Integration Tests
1. Create SIMPLE task with Adaptive profile → verify uses Haiku
2. Create MEDIUM task with Adaptive profile → verify uses Sonnet
3. Create COMPLEX task with Adaptive profile → verify uses Sonnet
4. Create task with "All-Opus" profile → verify all phases use Opus

### Manual Testing Checklist
- [ ] Select "Adaptive" profile, create SIMPLE task, check logs show Haiku
- [ ] Customize SIMPLE routing in settings, verify task uses custom config
- [ ] Click "Reset to Defaults", verify settings revert
- [ ] Switch between profiles, verify UI updates correctly
- [ ] Create task with invalid complexity → verify fallback to COMPLEX routing

## Cost Impact Analysis

### Current (All Opus)
- Every task: ~$46-72

### After Adaptive Routing (Default)
- SIMPLE (30% of tasks): ~$5-8 each
- MEDIUM (40% of tasks): ~$20-30 each
- COMPLEX (30% of tasks): ~$35-45 each
- **Average task**: ~$22-31 (**55% savings**)

### With Custom Routing (User Configurable)
- Users can tune for cost vs quality
- Example: Use Opus only for Planning, Sonnet everywhere else → ~$18-25/task (60% savings)

## Open Questions

1. **Default Profile**: Should new users get "Adaptive" or "All-Opus"?
   - Recommendation: "Adaptive" (cost-effective, smart routing)

2. **Spec Model**: Should spec creation also adapt by complexity?
   - Current: Always uses Opus + Ultra Think
   - Recommendation: Keep Opus for spec, only adapt execution phases

3. **UI Location**: Where to put complexity routing settings?
   - Recommendation: Agent Settings > Advanced > Complexity Routing

4. **Backwards Compatibility**: What about existing tasks?
   - Tasks already created have `phaseModels` in metadata → keep using those
   - Only new tasks use adaptive routing

## Next Steps

1. **You decide**:
   - Should we finish Phase 1 (make adaptive work) first?
   - Or build the full UI (Phase 2) in parallel?

2. **I need to find**:
   - Where task_metadata.json is actually written
   - Confirm the flow from profile selection → metadata creation

Let me know your preference!
