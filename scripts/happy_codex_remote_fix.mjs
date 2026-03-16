#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HAPPY_CODER_ROOT =
  process.env.HAPPY_CODER_ROOT || "/opt/homebrew/lib/node_modules/happy-coder";
const RUN_CODEX_FILE = path.join(HAPPY_CODER_ROOT, "dist", "runCodex-DarzxcRd.mjs");
const OVERLAY_BASE_DIR = path.join(os.tmpdir(), "happy-coder-codex-hotfix");
const PREPARE_ONLY = process.argv.includes("--prepare-only");
const HOTFIX_VERSION = "4";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const overlayRoot = await prepareOverlay();

  if (PREPARE_ONLY) {
    console.log(overlayRoot);
    return;
  }

  const entrypoint = path.join(overlayRoot, "dist", "index.mjs");
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--no-deprecation", entrypoint, "codex"],
    {
      stdio: "inherit",
      env: process.env
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

async function prepareOverlay() {
  const source = await fsp.readFile(RUN_CODEX_FILE, "utf8");
  const sourceHash = createHash("sha1")
    .update(source)
    .update(HOTFIX_VERSION)
    .digest("hex")
    .slice(0, 12);
  const overlayRoot = path.join(OVERLAY_BASE_DIR, sourceHash);
  const patchedRunCodexFile = path.join(overlayRoot, "dist", path.basename(RUN_CODEX_FILE));

  if (fs.existsSync(patchedRunCodexFile)) {
    return overlayRoot;
  }

  await fsp.rm(overlayRoot, { recursive: true, force: true });
  await fsp.mkdir(path.join(overlayRoot, "dist"), { recursive: true });

  const rootEntries = await fsp.readdir(HAPPY_CODER_ROOT, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name === "dist") {
      continue;
    }
    await symlinkEntry(
      path.join(HAPPY_CODER_ROOT, entry.name),
      path.join(overlayRoot, entry.name),
      entry
    );
  }

  const distDir = path.join(HAPPY_CODER_ROOT, "dist");
  const distEntries = await fsp.readdir(distDir, { withFileTypes: true });
  for (const entry of distEntries) {
    if (entry.name === path.basename(RUN_CODEX_FILE)) {
      continue;
    }
    await symlinkEntry(
      path.join(distDir, entry.name),
      path.join(overlayRoot, "dist", entry.name),
      entry
    );
  }

  await fsp.writeFile(patchedRunCodexFile, patchRunCodex(source), "utf8");
  return overlayRoot;
}

async function symlinkEntry(sourcePath, targetPath, entry) {
  let type = "file";
  if (entry.isDirectory()) {
    type = process.platform === "win32" ? "junction" : "dir";
  }
  await fsp.symlink(sourcePath, targetPath, type);
}

function patchRunCodex(source) {
  const withClientFallbackIdProperty = replaceOnce(
    source,
    "  permissionHandler = null;\n",
    '  permissionHandler = null;\n  lastApprovalCallId = null;\n  pendingApprovalCounter = 0;\n  normalizeApprovalId(value) {\n    if (value === void 0 || value === null) return null;\n    if (typeof value !== "string") return value;\n    const trimmed = value.trim();\n    if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;\n    return trimmed;\n  }\n'
  );

  const withClientFallbackRequestFields = replaceOnce(
    withClientFallbackIdProperty,
    `          const result = await this.permissionHandler.handleToolCall(
            params.codex_call_id,
            toolName,
            {
              command: params.codex_command,
              cwd: params.codex_cwd
            }
          );`,
    `          const toolCallId = this.normalizeApprovalId(params.codex_call_id) ?? this.normalizeApprovalId(params.call_id) ?? this.normalizeApprovalId(this.lastApprovalCallId) ?? this.normalizeApprovalId(request.id) ?? \`pending-approval-\${++this.pendingApprovalCounter}\`;
          const result = await this.permissionHandler.handleToolCall(
            toolCallId,
            toolName,
            {
              command: params.codex_command ?? params.command ?? params.message,
              cwd: params.codex_cwd ?? params.cwd
            }
          );`
  );

  const withPermissionHandlerRequestIds = replaceOnce(
    withClientFallbackRequestFields,
    "  pendingRequests = /* @__PURE__ */ new Map();\n  session;\n",
    '  pendingRequests = /* @__PURE__ */ new Map();\n  session;\n  nextGeneratedRequestId = 0;\n  latestPendingRequestId = null;\n  actualToPendingRequestIds = /* @__PURE__ */ new Map();\n  normalizeRequestId(value) {\n    if (value === void 0 || value === null) return null;\n    if (typeof value !== "string") return value;\n    const trimmed = value.trim();\n    if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;\n    return trimmed;\n  }\n  ensureRequestId(value) {\n    return this.normalizeRequestId(value) ?? `pending-approval-${++this.nextGeneratedRequestId}`;\n  }\n  resolveRequestId(value) {\n    const normalizedId = this.normalizeRequestId(value);\n    if (normalizedId && this.pendingRequests.has(normalizedId)) {\n      return normalizedId;\n    }\n    if (normalizedId && this.actualToPendingRequestIds.has(normalizedId)) {\n      return this.actualToPendingRequestIds.get(normalizedId);\n    }\n    if (!normalizedId && this.pendingRequests.size === 1) {\n      return this.pendingRequests.keys().next().value;\n    }\n    return normalizedId;\n  }\n  recordActualCallId(value) {\n    const actualId = this.normalizeRequestId(value);\n    const pendingId = this.latestPendingRequestId;\n    if (!actualId || !pendingId || pendingId === actualId || !this.pendingRequests.has(pendingId)) {\n      return;\n    }\n    this.actualToPendingRequestIds.set(actualId, pendingId);\n    logger.debug(`[Codex] Linked approval call ID ${actualId} -> ${pendingId}`);\n  }\n'
  );

  const withPermissionHandlerToolCallFallback = replaceOnce(
    withPermissionHandlerRequestIds,
    `  async handleToolCall(toolCallId, toolName, input) {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(toolCallId, {
        resolve,
        reject,
        toolName,
        input
      });
      this.session.updateAgentState((currentState) => ({
        ...currentState,
        requests: {
          ...currentState.requests,
          [toolCallId]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now()
          }
        }
      }));
      logger.debug(\`[Codex] Permission request sent for tool: \${toolName} (\${toolCallId})\`);
    });
  }`,
    `  async handleToolCall(toolCallId, toolName, input) {
    const requestId = this.ensureRequestId(toolCallId);
    this.latestPendingRequestId = requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        toolName,
        input
      });
      this.session.updateAgentState((currentState) => ({
        ...currentState,
        requests: {
          ...currentState.requests,
          [requestId]: {
            tool: toolName,
            arguments: input,
            createdAt: Date.now()
          }
        }
      }));
      logger.debug(\`[Codex] Permission request sent for tool: \${toolName} (\${requestId})\`);
    });
  }`
  );

  const withPermissionHandlerResponseFallback = replaceOnce(
    withPermissionHandlerToolCallFallback,
    `        const pending = this.pendingRequests.get(response.id);
        if (!pending) {
          logger.debug("[Codex] Permission request not found or already resolved");
          return;
        }
        this.pendingRequests.delete(response.id);`,
    `        const requestId = this.resolveRequestId(response.id);
        const pending = requestId ? this.pendingRequests.get(requestId) : null;
        if (!pending) {
          logger.debug("[Codex] Permission request not found or already resolved");
          return;
        }
        this.pendingRequests.delete(requestId);
        for (const [actualId, pendingId] of this.actualToPendingRequestIds.entries()) {
          if (pendingId === requestId) {
            this.actualToPendingRequestIds.delete(actualId);
          }
        }
        if (this.latestPendingRequestId === requestId) {
          this.latestPendingRequestId = null;
        }`
  );

  const withPermissionHandlerStateCleanup = replaceOnce(
    withPermissionHandlerResponseFallback,
    `          const request = currentState.requests?.[response.id];
          if (!request) return currentState;
          const { [response.id]: _, ...remainingRequests } = currentState.requests || {};
          let res = {
            ...currentState,
            requests: remainingRequests,
            completedRequests: {
              ...currentState.completedRequests,
              [response.id]: {
                ...request,
                completedAt: Date.now(),
                status: response.approved ? "approved" : "denied",
                decision: result.decision
              }
            }
          };`,
    `          const request = currentState.requests?.[requestId];
          if (!request) return currentState;
          const { [requestId]: _, ...remainingRequests } = currentState.requests || {};
          let res = {
            ...currentState,
            requests: remainingRequests,
            completedRequests: {
              ...currentState.completedRequests,
              [requestId]: {
                ...request,
                completedAt: Date.now(),
                status: response.approved ? "approved" : "denied",
                decision: result.decision
              }
            }
          };`
  );

  const withPermissionHandlerResetCleanup = replaceOnce(
    withPermissionHandlerStateCleanup,
    `    this.pendingRequests.clear();
    this.session.updateAgentState((currentState) => {`,
    `    this.pendingRequests.clear();
    this.actualToPendingRequestIds.clear();
    this.latestPendingRequestId = null;
    this.nextGeneratedRequestId = 0;
    this.session.updateAgentState((currentState) => {`
  );

  return replaceOnce(
    withPermissionHandlerResetCleanup,
    `    if (msg.type === "exec_command_begin" || msg.type === "exec_approval_request") {
      let { call_id, type, ...inputs } = msg;
      session.sendCodexMessage({`,
    `    if (msg.type === "exec_command_begin" || msg.type === "exec_approval_request") {
      let { call_id, type, ...inputs } = msg;
      if (type === "exec_approval_request") {
        client.lastApprovalCallId = call_id;
        permissionHandler.recordActualCallId(call_id);
      }
      session.sendCodexMessage({`
  );
}

function replaceOnce(source, needle, replacement) {
  if (!source.includes(needle)) {
    throw new Error(`Hotfix failed: expected snippet not found:\n${needle}`);
  }
  return source.replace(needle, replacement);
}
