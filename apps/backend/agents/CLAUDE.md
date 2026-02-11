# Agents Module

This module contains the autonomous agent implementations for Auto-Claude.

## Components

- **coder.py** - Main autonomous coding agent
- **planner.py** - Task planning and breakdown
- **session.py** - Agent session management
- **memory_manager.py** - Memory and context handling
- **base.py** - Shared utilities and constants

## Architecture

This module follows a single-agent architecture without external parallelism.
Each agent runs autonomously to complete tasks.

## Subagent Architecture

The system does NOT use external subagent-based parallel work.
All task execution happens within a single autonomous agent loop.
Parallel work coordination is handled internally, not through separate subagent processes.
