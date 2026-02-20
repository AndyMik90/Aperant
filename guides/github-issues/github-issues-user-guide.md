# GitHub Issues User Guide

> Your complete guide to using GitHub Issues integration in Auto Claude

**Last updated:** 2026-02-20
**Audience:** All users | **Prerequisites:** None

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start (5 Minutes)](#quick-start-5-minutes)
3. [Key Features](#key-features)
4. [Integration Workflow](#integration-workflow)
5. [Setup & Configuration](#setup--configuration)
6. [Settings Reference](#settings-reference)
7. [Using the Features](#using-the-features)
8. [FAQ](#faq)

---

## Overview

The GitHub Issues integration brings AI-powered investigation and autonomous development directly to your GitHub issues. Think of it as having a team of senior developers analyze your issues, find root causes, and prepare implementation plans—all automatically.

### What Can It Do?

- **Import issues** from any GitHub repository
- **Run AI investigations** with 4 specialist agents in a two-phase pipeline
- **Create Auto Claude tasks** directly from investigation results
- **Post findings** back to GitHub as comments
- **Track progress** from issue to completed work

### Why Use It?

Traditional issue handling involves manual investigation, debugging, and planning. Auto Claude's GitHub Issues integration automates this:

- **Save time:** AI investigates while you focus on other work
- **Deeper insights:** 4 specialists analyze your issue (root cause, impact, fixes, reproducibility)
- **Seamless workflow:** Go from GitHub issue to implemented feature without leaving Auto Claude
- **Consistent quality:** Every investigation follows the same thorough process

---

## Quick Start (5 Minutes)

Get your first issue investigated in under 5 minutes.

### Prerequisites

1. **Auto Claude installed** - Download from [GitHub Releases](https://github.com/AndyMik90/Auto-Claude/releases)
2. **GitHub account** - Any account with access to your target repository
3. **Claude credentials** - A Claude Code subscription (OAuth) or API key configured in Auto Claude settings

### Step 1: Connect Your Repository (1 minute)

1. Open Auto Claude and open your project
2. Go to **Project Settings → GitHub Integration**
3. Click **"Connect Repository"**
4. Enter your repository in `owner/repo` format (e.g., `AndyMik90/Auto-Claude`)
5. Choose your authentication method:
   - **OAuth** (recommended) - Sign in with your GitHub account
   - **GitHub CLI** - For advanced users with `gh` installed
6. Click **"Connect"** and authorize when prompted

> **Note:** The first time you connect, you'll need to authorize access. This is a one-time setup per project.

### Step 2: Import Issues (30 seconds)

1. Navigate to **GitHub Issues** in the sidebar
2. Click **"Fetch Issues"**
3. Select filter: Open, Closed, or All
4. Issues load automatically (50 per page)

### Step 3: Investigate an Issue (2 minutes)

1. Click on any issue to view details
2. Click the **"Investigate"** button
3. Watch as 4 AI specialist agents analyze your issue:
   - **Phase 1** runs sequentially by default:
     - 🔍 **Root Cause Analyzer** - Finds the source of the issue
     - 🧪 **Reproducer** - Analyzes reproducibility (with root cause context)
   - **Phase 2** runs in parallel:
     - 📊 **Impact Assessor** - Determines affected areas and users
     - 💡 **Fix Advisor** - Suggests solution approaches (with root cause context)

### Step 4: Create a Task (30 seconds)

Once investigation completes:

1. Review the investigation report
2. Click **"Create Task"**
3. Auto Claude creates a new task with all investigation context
4. The task is ready for the autonomous build pipeline

**That's it!** You've converted a GitHub issue to a ready-to-build task in 5 minutes.

> **Next:** Learn about [all features](#key-features) or [configure settings](#setup--configuration)

---

## Key Features

### Issue Management

**Import & Browse**
- Fetch issues from any GitHub repository
- Filter by status: Open, Closed, or All
- Pagination for large repositories (50 issues per page)
- Real-time updates from GitHub

**Issue Details**
- Full issue view with title, description, and comments
- Labels, assignees, and milestones
- Issue metadata (created date, last updated, author)
- Linked pull requests and commits

### AI-Powered Investigation

**4 Specialist Agents (Two-Phase Pipeline)**
Each issue investigation runs 4 specialist agents in two phases:

| Specialist | What It Does | Why It Matters |
|------------|--------------|----------------|
| 🔍 **Root Cause Analyzer** | Traces bugs/issues to their source code | Know exactly what to fix |
| 📊 **Impact Assessor** | Determines affected areas and user impact | Understand the blast radius |
| 💡 **Fix Advisor** | Suggests concrete solution approaches | Compare options before coding |
| 🧪 **Reproducer** | Analyzes reproducibility and test coverage | Know if you have test coverage |

**Investigation Report**
The completed report includes:
- **Root cause location** - Exact files and line numbers when possible
- **Impact analysis** - Which features/users are affected
- **Fix approaches** - Multiple options with pros/cons
- **Reproducibility** - Can the issue be reproduced? Do tests exist?
- **Confidence levels** - How certain is each finding?
- **Image analysis** - Screenshots and images from the issue are analyzed for visual bugs, UI issues, and error messages

### Task Creation

**From Investigation to Task**
One click converts investigation results into an Auto Claude task:
- All investigation context included automatically
- Ready for the autonomous build pipeline
- Maintains link to original GitHub issue
- Tracked through completion

**Task Context Includes**
- Investigation findings
- Relevant code files
- Related issues/PRs
- Repository context

### GitHub Integration

**Post Findings**
Share investigation results directly to GitHub:
- Post investigation report as a comment
- Update issue labels
- Close issues after resolution

**Activity Tracking**
Every issue tracks:
- Investigation history
- Task creation events
- Resolution status
- Comments posted back to GitHub

---

## Integration Workflow

The GitHub Issues integration follows a simple pipeline from issue to completed work:

```mermaid
graph TD
    A[Import Issue from GitHub] --> B[Run AI Investigation]
    B --> C1[Root Cause Analyzer]
    B --> C2[Impact Assessor]
    B --> C3[Fix Advisor]
    B --> C4[Reproducer]
    C1 --> D[Aggregate Results]
    C2 --> D
    C3 --> D
    C4 --> D
    D --> E[Create Task in Auto Claude]
    E --> F[Autonomous Implementation]
    F --> G[Merge to Main Branch]
    G --> H[Close GitHub Issue]

    style A fill:#e1f5ff
    style B fill:#fff4e1
    style C1 fill:#e8f5e9
    style C2 fill:#e8f5e9
    style C3 fill:#e8f5e9
    style C4 fill:#e8f5e9
    style D fill:#fff4e1
    style E fill:#e1f5ff
    style F fill:#f3e5f5
    style G fill:#e1f5ff
    style H fill:#e8f5e9
```

### Stage Details

**1. Import Issue**
- Fetch from GitHub repository
- View with all context (comments, labels, metadata)
- Select based on priority, labels, or assignment

**2. Investigate with AI**
- 4 specialists analyze in two phases
- Root cause, impact, fix options, reproducibility
- Comprehensive report in minutes

**3. Create Task**
- One-click task creation
- All investigation context included
- Ready for autonomous build pipeline

**4. Implement**
- Auto Claude agents plan and implement
- Code review and QA validation
- All within isolated git worktree

**5. Merge & Close**
- Semantic merge back to main branch
- Update GitHub issue
- Close issue when complete

> This workflow keeps your main branch safe while autonomous agents work in isolated environments.

---

## Setup & Configuration

### GitHub Authentication

Auto Claude uses GitHub CLI for secure authentication:

**Step 1: Install GitHub CLI**
```bash
# macOS
brew install gh

# Windows
winget install --id GitHub.cli

# Linux
# See https://github.com/cli/cli#installation
```

**Step 2: Authenticate**
```bash
gh auth login
```

Follow the prompts:
1. Choose **GitHub.com**
2. Choose **HTTPS**
3. Choose **Login with a web browser**

**Step 3: Verify**
```bash
gh auth status
```

You should see your GitHub account information.

### Connect a Repository

1. Open Auto Claude
2. Create or open a project
3. Go to **Project Settings → GitHub Integration**
4. Click **"Connect Repository"**
5. Enter repository in `owner/repo` format: `AndyMik90/Auto-Claude`
6. Click **"Connect"**

Auto Claude verifies access and loads repository metadata.

---

## Settings Reference

GitHub Issues settings are organized into two locations:

1. **Project Settings** → Per-project investigation behavior
2. **Settings** → Agent → Global agent configuration for specialists

### Project Settings (Project Settings → GitHub Integration → AI Investigation)

These settings control how investigations behave for a specific project.

#### Task Automation

| Setting | Description | Default |
|---------|-------------|---------|
| **Auto-create tasks** | Automatically create kanban tasks from investigation results | Off |
| **Auto-start tasks** | Auto-start build pipeline when tasks are created | Off |
| **Pipeline mode** | Full / Skip to planning / Minimal | Full |

#### GitHub Integration

| Setting | Description | Default |
|---------|-------------|---------|
| **Auto-post to GitHub** | Automatically post investigation results to GitHub as comments | Off |
| **Auto-close issues** | Close GitHub issues when linked task completes | Off |

#### Investigation Behavior

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| **Max parallel investigations** | Maximum concurrent investigations | 3 | 1-10 |
| **Fast mode investigations** | Use Opus 4.6 Fast Mode (2.5x faster, higher cost) | Off | Toggle |
| **Phase 1 execution mode** | Sequential (stable) or Parallel (faster) | Sequential | Sequential / Parallel |

#### Label Filtering

| Setting | Description |
|---------|-------------|
| **Label include filter** | Only auto-create tasks for issues with these labels |
| **Label exclude filter** | Never auto-create tasks for issues with these labels |

#### Investigation Labels

Customize the labels applied to issues during the investigation lifecycle:

| Stage | Default Label | Description |
|-------|---------------|-------------|
| Investigating | `auto-claude:investigating` | AI is investigating this issue |
| Findings Ready | `auto-claude:findings-ready` | Investigation complete, findings available |
| Task Created | `auto-claude:task-created` | Kanban task created from investigation |
| Building | `auto-claude:building` | Task is being built by the pipeline |
| Done | `auto-claude:done` | Investigation complete, issue resolved |

You can customize the prefix, label names, colors, and descriptions.

### Agent Settings (Settings → Agent → Investigation Agents)

These global settings control which AI model and thinking level each specialist agent uses.

| Specialist | Default Model | Default Thinking | Description |
|------------|---------------|------------------|-------------|
| **Root Cause Analyzer** | Opus | High | Traces the bug to its source code (most intensive) |
| **Impact Assessor** | Sonnet | Medium | Determines blast radius and user impact |
| **Fix Advisor** | Sonnet | Medium | Suggests concrete solution approaches |
| **Reproducer** | Sonnet | Low | Analyzes reproducibility and test coverage |

**Understanding Models:**
- **Opus** — Most capable, best for deep analysis (Root Cause)
- **Sonnet** — Balanced capability and speed (Impact, Fix Advisor, Reproducer)

**Understanding Thinking Levels:**
- **High** — More thorough analysis, slower, higher cost
- **Medium** — Balanced depth and speed
- **Low** — Quick analysis, lower cost

> **Tip:** The Root Cause Agent uses Opus + High thinking by default because root cause analysis is the most critical and token-intensive part of the investigation. Reducing this may impact investigation quality.

---

## Using the Features

### Importing & Browsing Issues

**Fetch Issues**
1. Navigate to **GitHub Issues** in the sidebar
2. Click **"Fetch Issues"**
3. Select filter: Open, Closed, or All
4. Issues load with pagination (50 per page)

**Filter & Search**
- Use the filter dropdown to switch between Open/Closed/All
- Scroll to load more pages automatically
- Click any issue to view details

**Issue Detail View**
- Title and description
- All comments (chronological)
- Labels, assignees, milestones
- Metadata (created, updated, author)
- Linked pull requests and commits

### Running AI Investigations

**Start an Investigation**
1. Open any issue from the list
2. Review the issue details
3. Click the **"Investigate"** button

**Investigation Progress**
Watch as 4 specialist agents work through two phases:
- Each specialist shows progress in real-time
- Terminal output shows agent thinking
- Estimated time remaining updates continuously

**Investigation Results**
When complete, the report shows:
- **Root Cause** - What's causing the issue, where it is
- **Impact** - What's affected, who's impacted
- **Fix Options** - Multiple approaches with pros/cons
- **Reproducibility** - Can it be reproduced? Test coverage
- **Confidence** - How certain is each finding?

**Image Analysis**
If the issue contains screenshots or images:
- Images are automatically extracted from markdown (`![alt](url)`) and HTML (`<img>` tags)
- Root Cause Analyzer treats screenshots as **primary evidence**
- Visual bugs, UI issues, and error messages in images are analyzed
- Image URLs are included in the investigation context for all specialists

> **Tip:** Results vary by issue type. Bugs get detailed root causes; feature requests get architectural analysis.

### Creating Tasks from Results

**Create a Task**
1. Review the investigation report
2. Click **"Create Task"**
3. Confirm task details (auto-populated from investigation)
4. Task appears in your Auto Claude task list

**What's Included**
- Investigation findings
- Relevant code files and context
- Link to original GitHub issue
- Implementation suggestions from the Fix Advisor

**Next Steps**
The task is now ready for Auto Claude's autonomous pipeline:
- Planner agent breaks it into subtasks
- Coder agents implement the solution
- QA agents validate the work
- You review and merge

### Posting Findings to GitHub

**Share Results**
1. After investigation completes, click **"Post to GitHub"**
2. Choose what to include:
   - Full investigation report
   - Summary only
   - Custom message
3. Click **"Post"** to add as a comment

**Update Issue Status**
- Add labels based on investigation findings
- Close issue if resolved
- Link related tasks

**Activity Tracking**
All GitHub interactions are tracked:
- Comments posted
- Labels added
- Issues closed
- Timestamps for each action

---

## FAQ

### General

**Q: Do I need a GitHub account?**
A: Yes, you need a GitHub account with access to the repositories you want to investigate.

**Q: Does this work with private repositories?**
A: Yes, as long as your GitHub account has access to the private repository.

**Q: Can I investigate issues from any repository?**
A: Yes, any repository you have access to—your own repos, organization repos, or public repos.

### Investigation

**Q: How long does an investigation take?**
A: Typically 2-5 minutes for standard mode, 1-2 minutes with Fast Mode enabled. Complex issues may take longer.

**Q: What if the investigation doesn't find a root cause?**
A: The specialists report their confidence levels. Low confidence means more context is needed—try again after providing more information or reproduction steps.

**Q: Can I run multiple investigations at once?**
A: Yes, you can investigate multiple issues simultaneously. Each investigation runs independently with its own specialists.

**Q: Do investigations use my API quota?**
A: GitHub API calls are minimal (fetching issues). The heavy lifting is done by Auto Claude's AI agents, which use your Claude API subscription or configured profiles.

### Tasks & Implementation

**Q: Do I have to create a task after investigating?**
A: No, you can investigate just to understand the issue. Task creation is optional.

**Q: Can I edit the task before starting the build?**
A: Yes, the task is fully editable. You can modify the description, add requirements, or adjust the scope.

**Q: What happens to the task after implementation?**
A: The task goes through QA validation, then you review the changes before merging to your main branch.

### Troubleshooting

**Q: "Failed to fetch issues" error**
A: Check that:
- GitHub CLI is authenticated (`gh auth status`)
- Your repository URL is correct
- You have access to the repository

**Q: Investigation stuck at "Starting..."**
A: This usually means:
- Claude API is unreachable (check your connection)
- Rate limit hit (Auto Claude switches accounts automatically)
- Check Settings → Claude Profiles for account status

**Q: Results seem inaccurate**
A: Investigation quality depends on:
- Issue description quality (be specific!)
- Codebase accessibility
- Reproduction steps (if known)
- Screenshots/images (include these for visual bugs!)
Try providing more context and re-investigate.

**Q: Does the AI analyze screenshots in issues?**
A: Yes! Images embedded in issues (both markdown `![alt](url)` and HTML `<img>` tags) are automatically extracted and provided to the investigation specialists. The Root Cause Analyzer treats screenshots as primary evidence and will describe what it observes in images when diagnosing visual bugs, UI issues, or error messages.

---

## Next Steps

**For most users:** You're ready to go! Start investigating issues.

**For technical users:** See [Advanced AI Configuration](github-issues-advanced-ai-configuration.md) to optimize performance and costs.

**For developers:** See [Customization Guide](github-issues-customization-guide.md) to extend and customize the integration.

---

**Need help?** Join the [Auto Claude community](https://github.com/AndyMik90/Auto-Claude/discussions) or report issues [on GitHub](https://github.com/AndyMik90/Auto-Claude/issues).
