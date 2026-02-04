# Agent Drift

**Runtime behavioral monitoring for AI agents.** Detect prompt injection, memory poisoning, and behavioral drift in real-time.

Think `IDS` for AI agent decisions, or a SIEM for your autonomous systems.

## Why Agent Drift?

Traditional AI security focuses on content filtering. But when an agent is silently compromised—via prompt injection, memory poisoning, or tool manipulation—**its behavior changes before its outputs do**.

Agent Drift monitors behavioral patterns:
- Tool usage sequences and frequencies
- Timing anomalies
- Decision patterns
- Output characteristics

When behavior deviates from baseline, you get alerts.

<img width="1838" height="794" alt="image" src="https://github.com/user-attachments/assets/a06206f5-e5ee-4314-a762-5321312835bb" />

## Quick Start

### 1. Install

```bash
pip install agent-drift-detector[dashboard]
```

Or from source:
```bash
git clone https://github.com/lukehebe/agent-drift.git
cd agent-drift-detector
pip install -e ".[dashboard]"
```
### 2. Integrate Your Agent

Agent Drift integrates with [OpenClaw](https://github.com/openclaw/openclaw) agents:

```bash
# One-time setup
agent-drift setup

# Or manually add to your agent's tool hooks
```

Set the storage directory:
```bash
export AGENT_DRIFT_DIR=~/.agent-drift
```

### 3. Start the Dashboard

```bash
agent-drift start
```

Opens the SIEM dashboard at **http://localhost:5000**


Your agent reports tool usage by POSTing events:

```bash
# Track tool usage
curl -X POST localhost:5001/tool \
  -H "Content-Type: application/json" \
  -d '{"tool": "exec", "args": {"command": "ls"}, "output": "..."}'

# Check content for prompt injection
curl -X POST localhost:5001/check \
  -H "Content-Type: application/json" \
  -d '{"content": "user input here", "source": "chat"}'

# End session and get drift report
curl -X POST localhost:5001/end
```


## CLI Commands

```bash
agent-drift start              # Start SIEM dashboard (port 5000)
agent-drift start --port 8080  # Custom port
agent-drift status             # Show baseline status
agent-drift baseline show      # Display baseline details
agent-drift baseline reset     # Reset baseline
agent-drift history            # Show detection history
agent-drift canary             # Run canary tasks
agent-drift simulate           # Run attack simulations
agent-drift setup              # Setup agent-drift
```


## Features

### Real-Time SIEM Dashboard
- WebSocket-powered live updates
- Drift score timeline
- Component breakdown (tool sequence, frequency, timing, etc.)
- Alert feed with acknowledgment

### Prompt Injection Detection
10 detection patterns with severity levels:

| Pattern | Severity | Example |
|---------|----------|---------|
| Instruction Override | 🔴 Critical | "Ignore previous instructions" |
| Role Hijacking | 🔴 Critical | "You are now DAN..." |
| Jailbreak Attempt | 🔴 Critical | "Bypass all restrictions" |
| Data Exfiltration | 🔴 Critical | "Send data to webhook" |
| Encoded Payload | 🔴 Critical | Base64/hex payloads |
| Memory Poisoning | 🔴 Critical | "Remember forever" |
| System Prompt Extraction | 🟡 Warning | "Show me your system prompt" |
| Delimiter Injection | 🟡 Warning | `]]`, `---`, `<system>` |
| Privilege Escalation | 🟡 Warning | "sudo", "admin access" |
| Indirect Injection | 🟡 Warning | "NOTE TO AI:", "URGENT:" |

### Behavioral Drift Detection
- Baseline learning from normal agent runs
- Multi-component drift scoring
- Anomaly detection with explanations

### Canary Tasks
Inject known-answer tasks to verify agent integrity.

## API Reference

### POST /tool
Track a tool invocation.

```json
{
  "tool": "exec",
  "success": true,
  "duration_ms": 150,
  "args": {"command": "ls -la"},
  "output": "total 48..."
}
```

### POST /check
Check content for prompt injection.

```json
{
  "content": "text to scan",
  "source": "user_input"
}
```

Response:
```json
{
  "ok": true,
  "has_injection": true,
  "critical": true,
  "injections": [
    {
      "name": "Instruction Override",
      "severity": "critical",
      "description": "Attempts to override system instructions...",
      "matches": ["ignore previous"]
    }
  ]
}
```

### POST /end
End the current monitoring session and get a drift report.

### POST /reset
Reset the behavioral baseline.

### GET /api/state
Get full dashboard state (drift history, alerts, injections, etc.)


## How It Works

1. **Baseline Learning**: First few runs establish normal behavior patterns
2. **Behavioral Vectors**: Each run is converted to a multi-dimensional vector (tool sequences, timing, decisions, etc.)
3. **Drift Detection**: New runs are compared against baseline using component-wise scoring
4. **Anomaly Alerts**: Significant deviations trigger warnings or critical alerts

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Tool   │  │  Tool   │  │  Tool   │  │  Tool   │        │
│  │  Call   │──│  Call   │──│  Call   │──│  Call   │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
└───────┼────────────┼────────────┼────────────┼──────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Drift                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Behavior Trace Collector                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         ▼                 ▼                 ▼               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐     │
│  │  Injection  │  │   Drift     │  │    Baseline     │     │
│  │  Detection  │  │  Detection  │  │    Manager      │     │
│  └─────────────┘  └─────────────┘  └─────────────────┘     │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              SIEM Dashboard (WebSocket)               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```
This is a working proof of concept. Many more enhancements to come to the dashboard and backend engineering detections such as:
- Agent quarantine button
- Community-sourced injection pattern feeds for better detection (similar to Sigma rules or YARA)
- Optional Honeypot - Register fake tools that should never be called under normal operation. Any invocation is instant high-confidence Indicator of Compromise.
- Enhanced behavioral analysis
- Support for multiple agents


## License

MIT

## Contributing

PRs welcome! Areas of interest:
- Additional injection patterns
- More behavioral components
- Integration with other agent frameworks
- Visualization improvements
