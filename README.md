# OpenClaw Agent Stack

An open-source multi-agent automation framework for building practical AI workflows.

This repository combines:

- OpenClaw-style multi-agent roles
- Workflow automation (n8n)
- Command bridge utilities for Codex and Happy integration
- Reusable prompt and example patterns

## Why This Project

OpenClaw Agent Stack is designed as a practical reference implementation for developers who want to orchestrate multiple AI agents and connect them with real tools.

## Features

- Multi-agent orchestration pattern
- n8n workflow integration
- Telegram-driven automation flow template
- Quant trading experiment example
- Social media autoposting example
- Prompt library for agent design
- Local bridge scripts for Codex/Happy command workflows

## Architecture

Human -> Director Agent -> Worker Agents -> Tool Layer

Worker agents:

- Scouter: information discovery and research
- Writer: structured content generation
- Artist: visual asset generation

## Repository Structure

- `agents/`: role definitions for each agent
- `workflows/n8n/`: n8n workflow templates
- `examples/`: practical end-to-end scenarios
- `prompts/`: reusable prompts for agent behavior
- `docs/`: architecture and setup docs
- `scripts/`: bridge utilities and local tooling
- `shell/`: shell wrappers for quick launch

## Related Repositories

- [`openclaw-dashboard`](https://github.com/sparkingskin-tech/openclaw-dashboard): management UI for OpenClaw workflows
- [`xiaohongshu-publish-skill`](https://github.com/sparkingskin-tech/xiaohongshu-publish-skill): XiaoHongShu publishing skill for OpenClaw/Codex workflows
- [`treehole-private`](https://github.com/sparkingskin-tech/treehole-private): Treehole mini-program project (now public)

## Community Signals

- OpenClaw upstream issue contribution: [`openclaw/openclaw#47686`](https://github.com/openclaw/openclaw/issues/47686)

## Quick Start

1. Read [`docs/setup-guide.md`](docs/setup-guide.md)
2. Review agent roles under `agents/`
3. Import `workflows/n8n/telegram-agent-workflow.json` into n8n
4. Configure your LLM provider and Telegram bot
5. Run bridge utilities from `scripts/` as needed

## Existing Utilities

This repo includes production utility scripts:

- `scripts/happy_codex_bridge.mjs`
  - scans local Codex sessions
  - builds a thread/project manifest
  - syncs sessions into Happy
- `scripts/happy_codex_remote_fix.mjs`
  - patches the current Happy-Codex permission request mismatch
  - launches `happy codex` via a lightweight overlay
- `shell/happy-codex.zsh`
  - shell aliases/functions for scan, sync, listing, and launch

## Examples

### Quant Trading Agent

A simple experiment showing how an agent pipeline can inspect market context and output actionable trade notes.

### Social Media Automation

A workflow template for generating and scheduling social posts with role-based agent collaboration.

## Roadmap

- Agent memory layer
- Tool plugin registry
- Dashboard UI
- More real-world workflow templates

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening large changes.

## License

MIT License. See [`LICENSE`](LICENSE).
