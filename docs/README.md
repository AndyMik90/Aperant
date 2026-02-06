# Auto-Claude Documentation

**Updated:** 2026-02-06

---

## Quick Navigation

| Folder | Purpose |
|--------|---------|
| [ralph/](ralph/) | Ralph Loop prompts, results, and guides |
| [architecture/](architecture/) | System design and technical architecture |
| [plans/](plans/) | Feature proposals and design docs |
| [reports/](reports/) | Audit reports and analysis |
| [metrics/](metrics/) | Performance and duration tracking |
| [archive/](archive/) | Completed/historical documentation |

---

## Active Documents

### Ralph Loop System
- **[Ralph Prompt Guide](ralph/RALPH_PROMPT_GUIDE.md)** - How to write effective Ralph prompts
- **[Ralph Index](ralph/INDEX.md)** - Master index of all Ralph prompts and results
- **[Ralph Prompts](ralph/prompts/)** - Ready-to-run and completed prompts
- **[Ralph Results](ralph/results/)** - Execution outputs and logs

### Current Status
- **[Known Issues](KNOWN_ISSUES.md)** - Active issues and their status
- **[Code Sweep Report](CODE_SWEEP_REPORT.md)** - Latest codebase health scan

### Architecture
- **[Task Architecture](architecture/TASK_ARCHITECTURE.md)** - Task lifecycle and status flow
- **[Task Workflow](architecture/TASK_WORKFLOW.md)** - End-to-end task execution
- **[Full Architecture](architecture/FULL_ARCHITECTURE.md)** - Complete system overview

### Feature Planning
- **[Feature Proposals](plans/FEATURE_PROPOSALS.md)** - Proposed improvements
- **[Suggestions](plans/SUGGESTIONS.md)** - Ideas for future development
- **[UI Design](plans/UI_DESIGN.md)** - UI/UX design guidelines

---

## Folder Structure

```
docs/
├── README.md                 # This file
├── KNOWN_ISSUES.md           # Active issues tracker
├── CODE_SWEEP_REPORT.md      # Latest code health scan
│
├── ralph/                    # Ralph Loop automation
│   ├── INDEX.md              # Master prompt/result index
│   ├── RALPH_PROMPT_GUIDE.md # How to write prompts
│   ├── prompts/              # All Ralph prompts
│   └── results/              # Execution outputs
│
├── architecture/             # Technical documentation
│   ├── TASK_ARCHITECTURE.md
│   ├── TASK_WORKFLOW.md
│   ├── FULL_ARCHITECTURE.md
│   └── ...
│
├── plans/                    # Active planning docs
│   ├── FEATURE_PROPOSALS.md
│   ├── SUGGESTIONS.md
│   └── UI_DESIGN.md
│
├── reports/                  # Analysis and audits
├── metrics/                  # Performance tracking
├── tasks/                    # Task-specific docs
├── ui-reference/             # UI component reference
│
└── archive/                  # Historical/completed docs
    ├── fixes/                # Completed fix documentation
    ├── audits/               # Old audit reports
    └── completed-phases/     # Completed phase plans
```

---

## For Developers

### Key Concepts

**Task Status** (user-facing):
```
planning → coding → ai_review → human_review → done
```

**Execution Phase** (backend):
```
idle → planning → coding → qa_review → qa_fixing → complete
```

### Getting Started

1. Read [Task Architecture](architecture/TASK_ARCHITECTURE.md) to understand the system
2. Check [Known Issues](KNOWN_ISSUES.md) for current problems
3. See [Ralph Prompt Guide](ralph/RALPH_PROMPT_GUIDE.md) to automate tasks

---

## For Users

### Task Workflow

1. **Chat** - Describe your task to Jerry
2. **Planning** - Jerry creates a spec (automatic)
3. **Review** - You approve the plan, click "Start Build"
4. **Coding** - Jerry implements (automatic)
5. **Review** - Final approval
6. **Done** - Changes merged

---

## Contributing

- Add architecture docs to `architecture/`
- Add feature plans to `plans/`
- Add Ralph prompts to `ralph/prompts/`
- Archive completed work to `archive/`

---

**Need Help?** [GitHub Issues](https://github.com/AndyMik90/Auto-Claude/issues)
