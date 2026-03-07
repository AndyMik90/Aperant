## WEB BROWSER VALIDATION

For web frontend applications, use Puppeteer MCP tools for browser automation and validation.

### Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__puppeteer__puppeteer_connect_active_tab` | Connect to browser tab |
| `mcp__puppeteer__puppeteer_navigate` | Navigate to URL |
| `mcp__puppeteer__puppeteer_screenshot` | Take screenshot |
| `mcp__puppeteer__puppeteer_click` | Click element |
| `mcp__puppeteer__puppeteer_fill` | Fill input field |
| `mcp__puppeteer__puppeteer_select` | Select dropdown option |
| `mcp__puppeteer__puppeteer_hover` | Hover over element |
| `mcp__puppeteer__puppeteer_evaluate` | Execute JavaScript |

### Validation Flow

#### Step 1: Navigate to Page

```
Tool: mcp__puppeteer__puppeteer_navigate
Args: {"url": "http://localhost:3000"}
```

Navigate to the development server URL.

#### Step 2: Take Screenshot

```
Tool: mcp__puppeteer__puppeteer_screenshot
Args: {"name": "page-initial-state"}
```

Capture the initial page state for visual verification.

#### Step 3: Verify Elements Exist

```
Tool: mcp__puppeteer__puppeteer_evaluate
Args: {"script": "document.querySelector('[data-testid=\"feature\"]') !== null"}
```

Check that expected elements are present on the page.

#### Step 4: Test Interactions

**Click buttons/links:**
```
Tool: mcp__puppeteer__puppeteer_click
Args: {"selector": "[data-testid=\"submit-button\"]"}
```

**Fill form fields:**
```
Tool: mcp__puppeteer__puppeteer_fill
Args: {"selector": "input[name=\"email\"]", "value": "test@example.com"}
```

**Select dropdown options:**
```
Tool: mcp__puppeteer__puppeteer_select
Args: {"selector": "select[name=\"country\"]", "value": "US"}
```

#### Step 5: Check Console for Errors

```
Tool: mcp__puppeteer__puppeteer_evaluate
Args: {"script": "window.__consoleErrors || []"}
```

Or set up error capture before testing:
```
Tool: mcp__puppeteer__puppeteer_evaluate
Args: {
  "script": "window.__consoleErrors = []; const origError = console.error; console.error = (...args) => { window.__consoleErrors.push(args); origError.apply(console, args); };"
}
```

### Document Findings

```
BROWSER VERIFICATION:
- [Page/Component]: PASS/FAIL
  - Console errors: [list or "None"]
  - Visual check: PASS/FAIL
  - Interactions: PASS/FAIL
```

### Common Selectors

When testing UI elements, prefer these selector strategies:
1. `[data-testid="..."]` - Most reliable (if available)
2. `#id` - Element IDs
3. `button:contains("Text")` - By visible text
4. `.class-name` - CSS classes
5. `input[name="..."]` - Form fields by name

### Handling Common Issues

**Dev Server Not Running:**
If the development server is not running or the page cannot be loaded:

1. Check the project commands listed in the PROJECT CAPABILITIES section for the dev server command
2. Start the dev server and wait for it to be ready
3. If the server cannot be started:
   - **For specs with UI changes**: This is a CRITICAL blocking issue. Mark as **REJECTED** — visual verification is mandatory for UI changes
   - **For non-UI changes**: Document as "Browser validation skipped — no UI files changed" and proceed with code-based review
