#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const nodePath = require("node:path");
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function stripEditorSuffix(title) {
  return String(title ?? "")
    .replace(/\s+-\s+Visual Studio Code.*$/i, "")
    .replace(/\s+-\s+Kilo Code.*$/i, "")
    .trim();
}

function windowTitleScore(candidateTitle, windowTitle) {
  const normalizedCandidate = normalizeText(candidateTitle);
  const normalizedWindow = normalizeText(windowTitle);
  if (!normalizedCandidate || !normalizedWindow) {
    return -1;
  }

  if (normalizedCandidate === normalizedWindow) {
    return 100;
  }

  const strippedCandidate = normalizeText(stripEditorSuffix(candidateTitle));
  const strippedWindow = normalizeText(stripEditorSuffix(windowTitle));
  if (strippedCandidate && strippedCandidate === strippedWindow) {
    return 90;
  }

  if (
    normalizedWindow.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedWindow)
  ) {
    return 80;
  }

  if (
    strippedWindow &&
    strippedCandidate &&
    (strippedWindow.includes(strippedCandidate) ||
      strippedCandidate.includes(strippedWindow))
  ) {
    return 70;
  }

  return -1;
}

function groupTargetsByPage(targets) {
  const groups = [];
  let currentGroup = null;

  for (const target of targets) {
    if (target.type === "page") {
      currentGroup = { page: target, iframes: [] };
      groups.push(currentGroup);
      continue;
    }

    if (target.type === "iframe" && currentGroup) {
      currentGroup.iframes.push(target);
    }
  }

  return groups;
}

function findWindowGroupByTitle(groups, windowTitle) {
  if (groups.length === 0) {
    return null;
  }

  if (!windowTitle) {
    return groups.length === 1 ? groups[0] : null;
  }

  let bestGroup = null;
  let bestScore = -1;
  let tied = false;

  for (const group of groups) {
    const score = windowTitleScore(group.page.title, windowTitle);
    if (score > bestScore) {
      bestGroup = group;
      bestScore = score;
      tied = false;
      continue;
    }

    if (score >= 0 && score === bestScore) {
      tied = true;
    }
  }

  if (bestScore < 0 || tied) {
    return null;
  }

  return bestGroup;
}

function getWritableTempDir() {
  const windowsRoot = process.env.SystemRoot || "C:\\Windows";
  const windowsTemp = nodePath.join(windowsRoot, "Temp").toLowerCase();
  const candidates = [
    process.env.LOCALAPPDATA
      ? nodePath.join(process.env.LOCALAPPDATA, "Temp")
      : undefined,
    process.env.USERPROFILE
      ? nodePath.join(process.env.USERPROFILE, "AppData", "Local", "Temp")
      : undefined,
    process.env.TEMP,
    process.env.TMP,
    ".",
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (String(dir).toLowerCase() === windowsTemp) {
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Try next candidate.
    }
  }

  return ".";
}

function getVsCodeCdpPort() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA is not set");
  }

  const portFile = nodePath.join(appData, "Code", "DevToolsActivePort");
  if (!fs.existsSync(portFile)) {
    throw new Error(`VS Code DevToolsActivePort not found at ${portFile}`);
  }

  const content = fs.readFileSync(portFile, "utf8").trim();
  const port = Number.parseInt(content.split(/\r?\n/)[0], 10);
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid VS Code CDP port in ${portFile}`);
  }

  return port;
}

function getCdpTargets(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const targets = Array.isArray(parsed) ? parsed : [];
          resolve(
            targets.filter(
              (target) => target?.type && target?.webSocketDebuggerUrl
            )
          );
        } catch (error) {
          reject(
            new Error(
              `Failed to parse VS Code CDP targets: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error("VS Code CDP target request timed out"));
    });
  });
}

function findCodexIframeTarget(group) {
  return (
    group.iframes.find((target) =>
      normalizeText(target.url).includes("extensionid=openai.chatgpt")
    ) || null
  );
}

async function withTargetSocket(target, callback) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connect timeout"));
      }, 3000);

      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection error"));
      });
    });

    return await callback(ws);
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

function cdpEvaluate(ws, expression, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("CDP evaluate timed out"));
    }, 8000);

    const handler = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          if (payload.error) {
            reject(new Error(payload.error.message));
          } else {
            resolve(payload);
          }
        }
      } catch {
        // Ignore unrelated messages.
      }
    };

    ws.addEventListener("message", handler);
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      })
    );
  });
}

function getEvaluationValue(message) {
  return message?.result?.result?.value;
}

function getCodexScripts(message) {
  const escapedMessage = JSON.stringify(message);
  return {
    inject: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        if (!doc) return 'no_contentDocument';
        var input = doc.querySelector('div.ProseMirror[contenteditable="true"]');
        if (!input) input = doc.querySelector('.ProseMirror[contenteditable="true"]');
        if (!input) return 'input_not_found';
        input.focus();
        input.innerHTML = '';
        var paragraph = doc.createElement('p');
        paragraph.textContent = ${escapedMessage};
        input.appendChild(paragraph);
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${escapedMessage}, inputType: 'insertText' }));
        return 'injected';
      })()
    `,
    submit: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        var input = doc.querySelector('div.ProseMirror[contenteditable="true"]');
        if (!input) input = doc.querySelector('.ProseMirror[contenteditable="true"]');
        if (!input) return 'no_input';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'sent';
      })()
    `,
  };
}

function resolveWindowTitleFromHandle(identifier) {
  const handle = Number.parseInt(String(identifier).trim(), 10);
  if (!Number.isFinite(handle) || handle <= 0) {
    return null;
  }

  const tempDir = getWritableTempDir();
  const env = {
    ...process.env,
    TEMP: tempDir,
    TMP: tempDir,
  };

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinTitle {
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
$handle = [IntPtr]${handle}
if (-not [WinTitle]::IsWindow($handle)) {
    exit 2
}
$length = [WinTitle]::GetWindowTextLength($handle)
if ($length -le 0) {
    exit 3
}
$buffer = New-Object System.Text.StringBuilder($length + 1)
[void][WinTitle]::GetWindowText($handle, $buffer, $buffer.Capacity)
$title = $buffer.ToString()
if ([string]::IsNullOrWhiteSpace($title)) {
    exit 4
}
Write-Output $title
`;

  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();
  } catch {
    return null;
  }
}

function resolveIdentifierToWindowTitle(identifier) {
  const rawIdentifier = String(identifier ?? "").trim();
  if (!rawIdentifier) {
    throw new Error("Window identifier is required");
  }

  if (/^\d+$/.test(rawIdentifier)) {
    return resolveWindowTitleFromHandle(rawIdentifier) || rawIdentifier;
  }

  return rawIdentifier;
}

async function sendIntoCodexTarget(target, message) {
  const scripts = getCodexScripts(message);

  return withTargetSocket(target, async (ws) => {
    const injectResult = await cdpEvaluate(ws, scripts.inject, 1);
    const injectValue = getEvaluationValue(injectResult);
    if (injectValue !== "injected") {
      throw new Error(`CDP inject returned: ${String(injectValue)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    const submitResult = await cdpEvaluate(ws, scripts.submit, 2);
    const submitValue = getEvaluationValue(submitResult);
    if (submitValue !== "sent") {
      throw new Error(`CDP submit returned: ${String(submitValue)}`);
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const probe = args.probe === "true";
  const identifier = args.identifier;

  if (!identifier) {
    throw new Error("--identifier is required");
  }

  if (!probe && !args.messagePath) {
    throw new Error("--messagePath is required unless --probe is used");
  }

  const resolvedWindowTitle = resolveIdentifierToWindowTitle(identifier);
  const port = getVsCodeCdpPort();
  const targets = await getCdpTargets(port);
  const groups = groupTargetsByPage(targets);
  const windowGroup = findWindowGroupByTitle(groups, resolvedWindowTitle);

  if (!windowGroup) {
    throw new Error(
      `No unique VS Code CDP page matched "${resolvedWindowTitle}".`
    );
  }

  const codexIframeTarget = findCodexIframeTarget(windowGroup);
  if (!codexIframeTarget) {
    throw new Error(`Codex webview not found in "${windowGroup.page.title}".`);
  }

  if (probe) {
    console.log(
      JSON.stringify(
        {
          success: true,
          port,
          identifier: String(identifier),
          resolvedWindowTitle,
          matchedPageTitle: windowGroup.page.title,
          codexTargetUrl: codexIframeTarget.url,
        },
        null,
        2
      )
    );
    return;
  }

  const message = fs.readFileSync(args.messagePath, "utf8");
  if (!message.trim()) {
    throw new Error("Message file is empty");
  }

  await sendIntoCodexTarget(codexIframeTarget, message);
  console.log(
    JSON.stringify(
      {
        success: true,
        identifier: String(identifier),
        resolvedWindowTitle,
        matchedPageTitle: windowGroup.page.title,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
