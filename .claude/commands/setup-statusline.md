# Setup ccstatusline Integration for Auto-Build

Configure ccstatusline to display real-time ac-jerry progress in your Claude Code status bar.

## Prerequisites

1. **ccstatusline** must be installed and configured
2. **auto-claude** must be in your project

## Installation

### Step 1: Install ccstatusline (if not already installed)

```bash
# Using npx
npx ccstatusline@latest

# Or using bunx
bunx ccstatusline@latest
```

This launches the interactive TUI to configure your status line.

### Step 2: Add Custom Command Widget

In the ccstatusline TUI config, add a **Custom Command** widget with:

```
Command: python /path/to/your/project/ac-jerry/statusline.py --format compact
```

**Recommended widget settings:**
- Position: Left or center of status line
- Update interval: 5 seconds (default)
- Show only when active: Yes (recommended)

### Step 3: Alternative - JSON Config

Edit `~/.config/ccstatusline/settings.json` and add to your widgets array:

```json
{
  "type": "custom",
  "command": "python /path/to/your/project/ac-jerry/statusline.py --format compact",
  "interval": 5,
  "showWhenEmpty": false
}
```

## Output Formats

The statusline.py script supports three output formats:

### Compact (recommended for status line)
```
--format compact
```
Output: `▣ 3/12 | ◆ Setup → | ⚡2 | 25%`

Shows: chunks completed/total | current phase | active workers | progress %

### Full (detailed multi-line)
```
--format full
```
Output:
```
AUTO-BUILD: my-feature
State: BUILDING
Chunks: 3/12 (1 in progress)
Phase: 2/4 - Setup
Workers: 2 active
```

### JSON (for scripting)
```
--format json
```
Output: Raw JSON status data

## Status File

Auto-build writes status to `.auto-claude-status` in your project root:

```json
{
  "active": true,
  "spec": "001-feature",
  "state": "building",
  "chunks": {
    "completed": 3,
    "in_progress": 1,
    "pending": 8,
    "total": 12
  },
  "phase": {
    "current": "Setup",
    "id": 2,
    "total": 4
  },
  "workers": {
    "active": 2,
    "max": 3
  }
}
```

## Icons Reference

When active, you'll see these indicators:

| Icon | Meaning |
|------|---------|
| ▣/▢ | Chunk progress (filled/empty) |
| ◆ | Current phase |
| ⚡ | Active workers |
| → | In progress indicator |
| ✓ | Completed |
| ✗ | Error |

## Troubleshooting

### Status not showing?
1. Check if `.auto-claude-status` exists in your project root
2. Verify the path to `statusline.py` is correct
3. Try running the command manually: `python ac-jerry/statusline.py --format compact`

### Updates too slow?
- Decrease the polling interval in ccstatusline config (minimum 1 second)

### Wrong project directory?
- Use `--project-dir /path/to/project` to specify the project root explicitly

## Example Configurations

### Minimal Status Line
Just chunks and phase:
```
python ac-jerry/statusline.py --format compact
```

### With Specific Spec
Monitor a specific spec:
```
python ac-jerry/statusline.py --format compact --spec 001-my-feature
```

### Full Path for Global Use
```
python ~/projects/my-app/ac-jerry/statusline.py --format compact --project-dir ~/projects/my-app
```
