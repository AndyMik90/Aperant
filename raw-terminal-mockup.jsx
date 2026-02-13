import { useState } from "react";

const PHASES = {
  planning: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.08)", label: "Planning" },
  coding: { color: "#3b82f6", bg: "rgba(59, 130, 246, 0.08)", label: "Coding" },
  validation: { color: "#a855f7", bg: "rgba(168, 85, 247, 0.08)", label: "Validation" },
};

// Simulated raw terminal data (based on user's actual output)
const currentRawOutput = `═══ Phase: planning Starting spec creation process
╔ SPEC CREATION ORCHESTRATOR ════════════════════════════════════════╗
║ Spec Directory: /Users/jamie/Documents/GitHub/GameGene...          ║
║ Project: /Users/jamie/Documents/GitHub/GameGenerator               ║
║ Task: Build the complete HTML export pipeline allowing users...    ║
ℹ Using cached project index
│ 📁 PHASE 1: PROJECT DISCOVERY                                      │
Starting phase 1: PROJECT DISCOVERY
Starting phase 1: PROJECT DISCOVERY
Discovered 8 files in project
Discovered 8 files in project
✓ Created project_index.json
│ 📄 PHASE 2: REQUIREMENTS GATHERING                                 │
Starting phase 2: REQUIREMENTS GATHERING
Starting phase 2: REQUIREMENTS GATHERING
✓ requirements.json already exists
◐ Classifying task complexity...
Security settings: /Users/jamie/Documents/GitHub/GameGenerator/.claude_settings.json
- Sandbox enabled (OS-level bash isolation)
- Filesystem restricted to: /Users/jamie/Documents/GitHub/GameGenerator
- Bash commands restricted to allowlist
- Extended thinking: disabled
- MCP servers: context7 (documentation), graphiti-memory (knowledge graph)
- CLAUDE.md: not found in project root
- Claude CLI: /opt/homebrew/bin/claude
Classification failed: 'ClaudeSDKClient' object has no attribute 'create_agent_session'. Defaulting to MEDIUM.
Task complexity: MEDIUM - Classification failed, using default complexity
✓ Task classified as MEDIUM: Classification failed, using default complexity
[Tool: Read]
[Tool: Read] Now let me explore the project structure to better understand the scope of changes needed:__TASK_LOG_TEXT__:{"content": "Now let me explore the project structure...", "phase": "planning", "type": "text"}
[Tool: Bash] Using cached security profile (hash: 567d754e)
[Tool: Glob]
[Tool: Glob]
[Tool: Bash]
[Tool: Read]
[Tool: Read]
[Tool: Bash]
[Tool: Read]
[Tool: Read]
[Tool: Bash]
[Tool: Grep]
[Tool: Grep]
[Tool: Grep]
[Tool: Read]
[Tool: Bash]
[Tool: Bash]
[Tool: Bash]
[Tool: Bash]
[Tool: Read] Now I have enough information to complete my assessment.__TASK_LOG_TEXT__:{"content": "Now I have enough info...", "phase": "planning", "type": "text"}
[Tool: Write]
[Tool: Bash]
[Tool: Read] Now let me update this assessment based on my deeper codebase analysis:__TASK_LOG_TEXT__:{"content": "update assessment", "phase": "planning"}
[Tool: Edit]
[Tool: Edit]`;

// Proposed Claude Code-style rendering
const proposedBlocks = [
  { type: "phase", phase: "planning", label: "Planning — Spec Creation" },
  { type: "system", text: "╔ SPEC CREATION ORCHESTRATOR ═══════════════════════════════════╗\n║ Project: /Users/jamie/Documents/GitHub/GameGenerator\n║ Task: Build the complete HTML export pipeline" },
  { type: "status", icon: "ℹ", text: "Using cached project index", variant: "info" },

  { type: "subphase", label: "Phase 1: Project Discovery" },
  { type: "status", icon: "✓", text: "Discovered 8 files in project", variant: "success" },
  { type: "status", icon: "✓", text: "Created project_index.json", variant: "success" },

  { type: "subphase", label: "Phase 2: Requirements Gathering" },
  { type: "status", icon: "✓", text: "requirements.json already exists", variant: "success" },
  { type: "status", icon: "◐", text: "Classifying task complexity...", variant: "pending" },
  { type: "status", icon: "✓", text: "Task classified as MEDIUM", variant: "success" },

  { type: "subphase", label: "Phase 3: Complexity Assessment" },
  { type: "text", text: "Now let me explore the project structure to better understand the scope of changes needed:" },
  { type: "tool", name: "Read", target: "src/frontend/src/utils/gameGenerators/index.ts", status: "success" },
  { type: "tool", name: "Read", target: "src/backend/game.py", status: "success" },
  { type: "tool", name: "Bash", target: "find . -name '*.tsx' -path '*/Constructor*'", status: "success" },
  { type: "tool", name: "Glob", target: "src/frontend/src/utils/gameGenerators/*.ts", status: "success" },
  { type: "tool", name: "Glob", target: "src/backend/routes/*.py", status: "success" },
  { type: "tool", name: "Bash", target: "wc -l src/frontend/src/utils/gameGenerators/*.ts", status: "success" },
  { type: "tool", name: "Read", target: "src/frontend/src/components/Constructor.tsx", status: "success" },
  { type: "tool", name: "Read", target: "src/frontend/src/components/ConstructorV2.tsx", status: "success" },
  { type: "tool", name: "Bash", target: "grep -r 'html_url' src/backend/", status: "success" },
  { type: "tool", name: "Read", target: "src/backend/models/game.py", status: "success" },
  { type: "tool", name: "Read", target: ".env.example", status: "success" },
  { type: "tool", name: "Bash", target: "ls src/frontend/src/utils/gameGenerators/", status: "success" },
  { type: "tool", name: "Grep", target: "exportHTML in *.tsx", status: "success" },
  { type: "tool", name: "Grep", target: "generateHTML in *.ts", status: "success" },
  { type: "tool", name: "Grep", target: "download.*html in *.tsx", status: "success" },
  { type: "tool", name: "Read", target: "package.json", status: "success" },
  { type: "tool", name: "Bash", target: "cat tsconfig.json", status: "success" },
  { type: "tool", name: "Bash", target: "cat vite.config.ts", status: "success" },
  { type: "tool", name: "Bash", target: "ls src/backend/routes/", status: "success" },
  { type: "tool", name: "Bash", target: "cat requirements.txt", status: "success" },

  { type: "text", text: "Now I have enough information to complete my assessment. Let me create the complexity assessment file:" },
  { type: "tool", name: "Write", target: "complexity_assessment.json", status: "success" },
  { type: "tool", name: "Bash", target: "cat complexity_assessment.json | python -m json.tool", status: "success" },

  { type: "text", text: "Now let me update this assessment based on my deeper codebase analysis:" },
  { type: "tool", name: "Edit", target: "complexity_assessment.json", status: "success" },
  { type: "tool", name: "Edit", target: "complexity_assessment.json", status: "success" },

  { type: "text", text: "Excellent! I've completed the complexity assessment for the HTML export pipeline task.\n\nVERDICT: STANDARD Complexity (downgraded from COMPLEX)\n\nKey discoveries: HTML generation functions already exist and produce standalone HTML. Backend only needs to store pre-generated HTML and provide URLs." },

  { type: "subphase", label: "Phase 4: Context Discovery" },
  { type: "status", icon: "✓", text: "context.json already exists", variant: "success" },

  { type: "subphase", label: "Phase 5: Spec Document Creation" },
  { type: "status", icon: "✓", text: "spec.md already exists and is valid", variant: "success" },

  { type: "subphase", label: "Phase 6: Implementation Planning" },
  { type: "status", icon: "✓", text: "implementation_plan.json already exists and is valid", variant: "success" },

  { type: "subphase", label: "Phase 7: Final Validation" },
  { type: "status", icon: "✓", text: "prereqs: PASS", variant: "success" },
  { type: "status", icon: "✓", text: "context: PASS", variant: "success" },
  { type: "status", icon: "✓", text: "spec: PASS", variant: "success" },
  { type: "status", icon: "✓", text: "plan: PASS", variant: "success" },

  { type: "complete", text: "Spec creation complete — STANDARD complexity, 8 phases run" },
  { type: "status", icon: "✓", text: "Ralph prompt generated: ralph_prompt.md", variant: "success" },
];

const TOOL_STYLES = {
  Read: { icon: "📄", color: "#22d3ee" },
  Write: { icon: "✏️", color: "#34d399" },
  Edit: { icon: "🔧", color: "#fbbf24" },
  Bash: { icon: "⚡", color: "#a78bfa" },
  Glob: { icon: "🔍", color: "#60a5fa" },
  Grep: { icon: "🔎", color: "#f472b6" },
};

function ProposedBlock({ block }) {
  if (block.type === "phase") {
    const phase = PHASES[block.phase];
    return (
      <div className="mt-4 mb-2" style={{ borderLeft: `3px solid ${phase.color}`, paddingLeft: 12 }}>
        <div style={{ color: phase.color, fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
          {block.label}
        </div>
      </div>
    );
  }

  if (block.type === "subphase") {
    return (
      <div style={{ padding: "8px 0 4px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>
          {block.label}
        </span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>
    );
  }

  if (block.type === "system") {
    return (
      <div style={{
        fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.4)",
        padding: "6px 12px", margin: "4px 0", whiteSpace: "pre-wrap",
        background: "rgba(255,255,255,0.02)", borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.04)"
      }}>
        {block.text}
      </div>
    );
  }

  if (block.type === "status") {
    const colors = {
      success: "#34d399",
      info: "#60a5fa",
      pending: "#fbbf24",
      error: "#f87171",
    };
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "2px 0",
        fontFamily: "monospace", fontSize: 12
      }}>
        <span style={{ color: colors[block.variant], width: 16, textAlign: "center" }}>{block.icon}</span>
        <span style={{ color: "rgba(255,255,255,0.7)" }}>{block.text}</span>
      </div>
    );
  }

  if (block.type === "tool") {
    const tool = TOOL_STYLES[block.name] || { icon: "🔧", color: "#888" };
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "1px 0",
        fontFamily: "monospace", fontSize: 12
      }}>
        <span style={{ fontSize: 10, width: 16, textAlign: "center" }}>{tool.icon}</span>
        <span style={{ color: tool.color, fontWeight: 500, minWidth: 40 }}>{block.name}</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{block.target}</span>
        <span style={{ marginLeft: "auto", fontSize: 10 }}>
          {block.status === "success" ? "✓" : block.status === "error" ? "✗" : "●"}
        </span>
      </div>
    );
  }

  if (block.type === "text") {
    return (
      <div style={{
        padding: "6px 0", fontFamily: "monospace", fontSize: 12,
        color: "rgba(255,255,255,0.85)", lineHeight: 1.5, whiteSpace: "pre-wrap"
      }}>
        {block.text}
      </div>
    );
  }

  if (block.type === "complete") {
    return (
      <div style={{
        margin: "8px 0", padding: "8px 12px", borderRadius: 6,
        background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.2)",
        fontFamily: "monospace", fontSize: 12, color: "#34d399", fontWeight: 500
      }}>
        ✓ {block.text}
      </div>
    );
  }

  return null;
}

export default function RawTerminalMockup() {
  const [view, setView] = useState("proposed");

  return (
    <div style={{
      background: "#0a0a0f", color: "#e8e6e3", minHeight: "100vh",
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 12
      }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Raw Terminal Mockup</span>
        <div style={{ flex: 1 }} />
        <div style={{
          display: "flex", gap: 2, background: "rgba(255,255,255,0.05)",
          borderRadius: 6, padding: 2
        }}>
          {["current", "proposed"].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "5px 14px", borderRadius: 4, fontSize: 12, fontWeight: 500,
                border: "none", cursor: "pointer", transition: "all 0.15s",
                background: view === v ? "rgba(255,255,255,0.1)" : "transparent",
                color: view === v ? "#fff" : "rgba(255,255,255,0.4)",
              }}
            >
              {v === "current" ? "Current Raw View" : "Proposed (Claude Code Style)"}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Tabs */}
      <div style={{
        padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", gap: 0
      }}>
        {["Raw", "Timeline", "Spec", "Prompt"].map((tab, i) => (
          <div
            key={tab}
            style={{
              padding: "8px 16px", fontSize: 12, fontWeight: 500,
              color: i === 0 ? "#fff" : "rgba(255,255,255,0.4)",
              borderBottom: i === 0 ? "2px solid #3b82f6" : "2px solid transparent",
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "8px 16px", maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
        {view === "current" ? (
          /* Current raw view - literal dump */
          <div style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
            {currentRawOutput}
          </div>
        ) : (
          /* Proposed Claude Code style */
          <div>
            {proposedBlocks.map((block, i) => (
              <ProposedBlock key={i} block={block} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
