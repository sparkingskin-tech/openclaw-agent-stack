# Setup Guide

## Requirements

- Node.js 18+
- OpenClaw runtime or compatible agent runtime
- n8n instance
- Telegram bot token
- LLM provider credentials (OpenAI, Gemini, or others)

## Step 1: Clone Repository

```bash
git clone https://github.com/sparkingskin-tech/openclaw-agent-stack.git
cd openclaw-agent-stack
```

## Step 2: Configure Agent Definitions

Review and edit files in `agents/*/agent.md`.

## Step 3: Import Workflow

Import `workflows/n8n/telegram-agent-workflow.json` into your n8n instance.

## Step 4: Connect Telegram

Set your bot token and webhook in n8n, then validate command routing.

## Step 5: Configure Local Bridge (Optional)

If using the included scripts:

```bash
node scripts/happy_codex_bridge.mjs scan
node scripts/happy_codex_bridge.mjs list threads
```

## Step 6: Run

Trigger tasks through Telegram or your chosen command channel and verify worker-agent responses.
