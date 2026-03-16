# Architecture

The system follows a multi-agent orchestration pattern.

## Flow

Human Command
  -> Director Agent
  -> Worker Agents
  -> External Tools

## Agent Roles

### Director

Routes goals, decomposes tasks, and coordinates worker outputs.

### Scouter

Collects facts, context, and references from available sources.

### Writer

Turns gathered inputs into structured outputs such as reports, posts, or action plans.

### Artist

Produces visual concepts and creative assets from task briefs.

## Tool Layer

- n8n workflow automation
- Telegram command/control channel
- LLM APIs
- Local scripts and external services

## Current Local Utility Layer

- Codex session scanning and manifest generation
- Sync bridge for Happy/Codex workspace integration
- Shell wrappers for launch and workflow shortcuts
