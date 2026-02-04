# Auto-Claude (Jerry) Documentation

Welcome to the Auto-Claude documentation! This folder contains architectural documentation, implementation plans, and guides for developers and users.

---

## Documentation Structure

```
docs/
├── README.md                          # This file
├── architecture/                      # System architecture documentation
│   ├── TASK_ARCHITECTURE.md          # Task status & execution phase architecture
│   └── TASK_WORKFLOW.md              # Complete task workflow (Chat → Done)
└── plans/                            # Implementation plans and proposals
    ├── TASK_STATUS_FIX_PLAN.md       # Plan to fix task status/phase UI issues
    ├── INTEGRATION_WORKFLOW.md       # Full implementation workflow
    └── KNOWN_ISSUES.md               # Known issues and proposed fixes
```

---

## Quick Links

### Architecture Documentation
- **[Task Workflow](architecture/TASK_WORKFLOW.md)** - 📋 Complete end-to-end task workflow
  - Chat → Planning → User Review → Coding → AI Review → Human Review → Done
  - Ralph-Wiggum Mode execution details
  - User action gates (where manual approval is required)
  - Alert requirements for spec completion

- **[Task Architecture](architecture/TASK_ARCHITECTURE.md)** - Comprehensive guide to task statuses, execution phases, and how they work together
  - ✅ Starting phase implementation details
  - ✅ Context-aware phase labels documentation
  - Documents race condition handling (now fixed)
  - Explains completedPhases tracking, fallback detection

### Implementation Plans
- **[Task Status Fix Plan](plans/TASK_STATUS_FIX_PLAN.md)** - ✅ COMPLETE - Task status/phase UI improvements
- **[Integration Workflow](plans/INTEGRATION_WORKFLOW.md)** - ✅ COMPLETE - Full implementation workflow

### Feature Proposals
- **[Feature Proposals](plans/FEATURE_PROPOSALS.md)** - 📋 NEW - Proposed improvements
  - #1: Remove Kanban drag-and-drop (fixes Issues #8, #9, #10)
  - #2: Combine Roadmap + Ideas into "Discovery Hub"
  - #3: Move MCP Overview to Settings (cleaner sidebar)

- **[Suggestions](plans/SUGGESTIONS.md)** - 💡 Ideas for future improvements
  - 20 suggestions organized by effort/impact
  - Quick wins, medium effort, larger investments

### Known Issues
- **[Known Issues](plans/KNOWN_ISSUES.md)** - ⚠️ 10 ISSUES DOCUMENTED - Awaiting fixes

  **CRITICAL:**
  - #6: Task auto-transitions from planning to coding without user action
  - #8: Kanban drag auto-starts coding agent (bypasses Start Build)

  **HIGH:**
  - #1: startBuild error not shown in UI
  - #2: Phase labels not updating in real time
  - #3: Planning agent not starting on app restart
  - #4: Stuck task recovery calling wrong handler
  - #5: Terminal output not legible (empty commands, no file paths)
  - #7: No alert when planning completes (user misses review window)
  - #9: No user-initiated flag to distinguish transition sources

  **MEDIUM:**
  - #10: Status validation allows all non-regressive transitions

### Main Project Documentation
- **[README.md](../README.md)** - Project overview and getting started guide
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - How to contribute to the project
- **[CHANGELOG.md](../CHANGELOG.md)** - Version history and changes

---

## For Developers

### Understanding the Codebase

1. **Start here:** [Task Architecture](architecture/TASK_ARCHITECTURE.md)
   - Learn about task lifecycle
   - Understand status vs execution phase
   - Common patterns and best practices

2. **Implementation plans:** [plans/](plans/)
   - Active development plans
   - Proposed changes and fixes
   - Technical specifications

### Key Concepts

**Task Status** (User-facing workflow):
```
planning → coding → ai_review → human_review → done
```

**Execution Phase** (Backend activity):
```
idle → planning → coding → qa_review → qa_fixing → complete
```

**Important:** Status and Phase are different! A task in "coding" status can be in "planning" phase (creating spec).

---

## For Users

### Complete Task Workflow

1. **Chat with Jerry** - Discuss and define your task
2. **Planning** (Auto) - Jerry creates spec and implementation plan
3. **Review Spec** (You) - Review the plan, then click "Start Build"
4. **Coding** (Auto) - Jerry implements the plan autonomously
5. **AI Review** (Auto) - Automated testing and quality checks
6. **Human Review** (You) - Final approval before merge
7. **Done** - Changes merged to your codebase

### Understanding Task States

- **Planning** - Task is being designed and spec is created
- **Coding** - Implementation is in progress (Ralph-Wiggum mode)
- **AI Review** - Automated testing and quality checks
- **Human Review** - Awaiting your approval
- **Done** - Task is complete and merged

### What the Badges Mean

- **"Starting..."** - System is initializing the task
- **"Creating Spec"** - Designing the implementation approach
- **"Implementing"** - Writing code
- **"Testing"** - Running automated tests
- **"Fixing Issues"** - Addressing test failures

---

## Contributing to Documentation

### Adding New Documentation

1. **Architecture docs** → Place in `architecture/`
   - System design documents
   - Component interactions
   - Data flow diagrams

2. **Implementation plans** → Place in `plans/`
   - Feature proposals
   - Bug fix plans
   - Technical specifications

3. **User guides** → Place in `guides/` (create if needed)
   - How-to guides
   - Tutorials
   - FAQ

### Documentation Standards

- Use Markdown format (`.md`)
- Include table of contents for long docs
- Add code examples where relevant
- Keep diagrams simple and clear
- Update this README when adding new docs

---

## Documentation Maintenance

### When to Update

- **Architecture docs:** When system design changes
- **Implementation plans:** When starting new features or fixes
- **Changelogs:** With every release

### Review Schedule

- Monthly review of architecture docs
- Update plans as features complete
- Archive old plans to `plans/archive/`

---

## Need Help?

- **Bug reports:** [GitHub Issues](https://github.com/AndyMik90/Auto-Claude/issues)
- **Questions:** Check the architecture docs first
- **Contributions:** See [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**Last Updated:** 2026-02-03
