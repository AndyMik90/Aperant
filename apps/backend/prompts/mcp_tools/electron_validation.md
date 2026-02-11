## ELECTRON APP VALIDATION

For Electron/desktop applications, use the electron-mcp-server tools to validate the UI.

**Prerequisites:**
- `ELECTRON_MCP_ENABLED=true` in environment
- Electron app running with `--remote-debugging-port=9222`
- Start with: `pnpm run dev:mcp` or `pnpm run start:mcp`

### Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__electron__get_electron_window_info` | Get info about running Electron windows |
| `mcp__electron__take_screenshot` | Capture screenshot of Electron window |
| `mcp__electron__send_command_to_electron` | Send commands (click, fill, evaluate JS) |
| `mcp__electron__read_electron_logs` | Read console logs from Electron app |

### Validation Flow

#### Step 1: Connect to Electron App

```
Tool: mcp__electron__get_electron_window_info
```

Verify the app is running and get window information. If no app found, document that Electron validation was skipped.

#### Step 2: Capture Screenshot

```
Tool: mcp__electron__take_screenshot
```

Take a screenshot to visually verify the current state of the application.

#### Step 3: Analyze Page Structure

```
Tool: mcp__electron__send_command_to_electron
Command: get_page_structure
```

Get an organized overview of all interactive elements (buttons, inputs, selects, links).

#### Step 4: Verify UI Elements

Use `send_command_to_electron` with specific commands:

**Click elements by text:**
```
Command: click_by_text
Args: {"text": "Button Text"}
```

**Click elements by selector:**
```
Command: click_by_selector
Args: {"selector": "button.submit-btn"}
```

**Fill input fields:**
```
Command: fill_input
Args: {"selector": "#email", "value": "test@example.com"}
# Or by placeholder:
Args: {"placeholder": "Enter email", "value": "test@example.com"}
```

**Send keyboard shortcuts:**
```
Command: send_keyboard_shortcut
Args: {"text": "Enter"}
# Or: {"text": "Ctrl+N"}, {"text": "Meta+N"}, {"text": "Escape"}
```

**Execute JavaScript:**
```
Command: eval
Args: {"code": "document.title"}
```

#### Step 5: Check Console Logs

```
Tool: mcp__electron__read_electron_logs
Args: {"logType": "console", "lines": 50}
```

Check for JavaScript errors, warnings, or failed operations.

### Document Findings

```
ELECTRON VALIDATION:
- App Connection: PASS/FAIL
  - Debug port accessible: YES/NO
  - Connected to correct window: YES/NO
- UI Verification: PASS/FAIL
  - Screenshots captured: [list]
  - Visual elements correct: PASS/FAIL
  - Interactions working: PASS/FAIL
- Console Errors: [list or "None"]
- Electron-Specific Features: PASS/FAIL
  - [Feature]: PASS/FAIL
- Issues: [list or "None"]
```

### Handling Common Issues

**App Not Running:**
If the Electron app is not running or debug port is not accessible:

1. Check the project commands listed in the PROJECT CAPABILITIES section for a debug/MCP startup script
2. Try starting the app with the appropriate command
3. If the app still cannot be started:
   - **For specs with UI changes**: This is a CRITICAL blocking issue. Mark as **REJECTED** — visual verification is mandatory for UI changes and cannot be skipped
   - **For non-UI changes**: Document as "Electron validation skipped — no UI files changed" and proceed with code-based review

**Headless Environment (CI/CD):**
If running in headless environment without display:
1. For UI changes: Document as critical issue — "Visual verification required but unavailable in headless environment"
2. For non-UI changes: Skip interactive Electron validation and rely on automated tests
