#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(WORKSPACE_ROOT, ".happy-codex-bridge");
const MANIFEST_FILE = path.join(STATE_DIR, "manifest.json");

const CODEX_HOME = expandHome(process.env.CODEX_HOME || "~/.codex");
const HAPPY_HOME = expandHome(process.env.HAPPY_HOME_DIR || "~/.happy");
const CODEX_INDEX_FILE = path.join(CODEX_HOME, "session_index.jsonl");
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const HAPPY_ACCESS_FILE = path.join(HAPPY_HOME, "access.key");
const HAPPY_SETTINGS_FILE = path.join(HAPPY_HOME, "settings.json");
const RAW_CODEX_BIN = process.env.CODEX_BIN || "/opt/homebrew/bin/codex";
const HAPPY_CODER_LIB =
  process.env.HAPPY_CODER_LIB ||
  "/opt/homebrew/lib/node_modules/happy-coder/dist/lib.mjs";
const HAPPY_CODEX_REMOTE_FIX =
  process.env.HAPPY_CODEX_REMOTE_FIX ||
  path.join(WORKSPACE_ROOT, "scripts", "happy_codex_remote_fix.mjs");

const DEFAULT_LIMIT = Infinity;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const { command, args, flags } = parseCli(process.argv.slice(2));

  switch (command) {
    case "sync": {
      const manifest = await buildManifest();
      await writeManifest(manifest);
      if (flags["dry-run"]) {
        printSyncSummary(manifest, true);
        return;
      }
      const result = await syncManifest(manifest, {
        limit: parseLimit(flags.limit),
        skipThreads: Boolean(flags["projects-only"]),
        skipProjects: Boolean(flags["threads-only"])
      });
      printSyncSummary(manifest, false, result);
      return;
    }
    case "scan": {
      const manifest = await buildManifest();
      await writeManifest(manifest);
      printSyncSummary(manifest, true);
      return;
    }
    case "list": {
      const kind = args[0] || "threads";
      const manifest = await loadOrBuildManifest();
      if (kind === "threads") {
        printThreads(manifest);
        return;
      }
      if (kind === "projects") {
        printProjects(manifest);
        return;
      }
      throw new Error(`Unsupported list target: ${kind}`);
    }
    case "launch": {
      const targetType = args[0];
      const targetKey = args[1];
      if (!targetType || !targetKey) {
        throw new Error("Usage: happy_codex_bridge.mjs launch <thread|project> <key>");
      }
      const manifest = await loadOrBuildManifest();
      if (targetType === "project") {
        const project = manifest.projects.find((entry) => entry.key === targetKey);
        if (!project) {
          throw new Error(`Project not found: ${targetKey}`);
        }
        await launchHappyInDirectory(project.cwd);
        return;
      }
      if (targetType === "thread") {
        const thread = manifest.threads.find(
          (entry) => entry.id === targetKey || entry.key === targetKey
        );
        if (!thread) {
          throw new Error(`Thread not found: ${targetKey}`);
        }
        console.error(
          `Launching project for local Codex thread ${thread.id} in ${thread.cwd || "(unknown cwd)"}`
        );
        await launchHappyInDirectory(thread.cwd || process.cwd());
        return;
      }
      throw new Error(`Unsupported launch target: ${targetType}`);
    }
    case "shell": {
      console.log(path.join(WORKSPACE_ROOT, "shell", "happy-codex.zsh"));
      return;
    }
    case "manifest": {
      const manifest = await loadOrBuildManifest();
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    default:
      printUsage();
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/happy_codex_bridge.mjs scan
  node scripts/happy_codex_bridge.mjs sync [--dry-run] [--limit N] [--threads-only] [--projects-only]
  node scripts/happy_codex_bridge.mjs list <threads|projects>
  node scripts/happy_codex_bridge.mjs launch <thread|project> <key>
  node scripts/happy_codex_bridge.mjs shell
  node scripts/happy_codex_bridge.mjs manifest`);
}

function parseCli(argv) {
  const args = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }
    const raw = token.slice(2);
    const [key, inlineValue] = raw.split("=", 2);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return {
    command: args[0] || "help",
    args: args.slice(1),
    flags
  };
}

async function loadOrBuildManifest() {
  if (fs.existsSync(MANIFEST_FILE)) {
    return JSON.parse(await fsp.readFile(MANIFEST_FILE, "utf8"));
  }
  const manifest = await buildManifest();
  await writeManifest(manifest);
  return manifest;
}

async function buildManifest() {
  const indexEntries = await readSessionIndex();
  const sessionFileMap = await collectSessionFiles(CODEX_SESSIONS_DIR);
  const threads = [];

  for (const entry of indexEntries) {
    const sessionFile = sessionFileMap.get(entry.id) || null;
    const sessionMeta = sessionFile ? await readSessionMeta(sessionFile) : null;
    const cwd = sessionMeta?.cwd || null;
    const key = `thread-${entry.id.slice(-8)}`;

    threads.push({
      key,
      id: entry.id,
      title: entry.thread_name || entry.id,
      updated_at: entry.updated_at || sessionMeta?.timestamp || null,
      cwd,
      session_file: sessionFile,
      cli_version: sessionMeta?.cli_version || null,
      originator: sessionMeta?.originator || null,
      model_provider: sessionMeta?.model_provider || null,
      source: sessionMeta?.source || null
    });
  }

  threads.sort(compareDescByUpdatedAt);

  const projects = buildProjectsFromThreads(threads);

  return {
    generated_at: new Date().toISOString(),
    workspace_root: WORKSPACE_ROOT,
    codex_home: CODEX_HOME,
    happy_home: HAPPY_HOME,
    threads,
    projects
  };
}

async function readSessionIndex() {
  if (!fs.existsSync(CODEX_INDEX_FILE)) {
    throw new Error(`Codex session index not found: ${CODEX_INDEX_FILE}`);
  }

  const raw = await fsp.readFile(CODEX_INDEX_FILE, "utf8");
  const latestById = new Map();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed?.id) continue;

    const existing = latestById.get(parsed.id);
    if (!existing || compareDescByUpdatedAt(parsed, existing) < 0) {
      latestById.set(parsed.id, parsed);
    }
  }

  return Array.from(latestById.values());
}

async function collectSessionFiles(rootDir) {
  const result = new Map();

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const match = entry.name.match(/-([0-9a-f-]{36})\.jsonl$/i);
      if (match) {
        result.set(match[1], fullPath);
      }
    }
  }

  await walk(rootDir);
  return result;
}

async function readSessionMeta(sessionFile) {
  const raw = await fsp.readFile(sessionFile, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === "session_meta" && parsed.payload) {
        return parsed.payload;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function buildProjectsFromThreads(threads) {
  const grouped = new Map();

  for (const thread of threads) {
    const cwd = thread.cwd || "(unknown cwd)";
    const bucket = grouped.get(cwd) || [];
    bucket.push(thread);
    grouped.set(cwd, bucket);
  }

  const projects = [];
  for (const [cwd, entries] of grouped.entries()) {
    entries.sort(compareDescByUpdatedAt);
    const cwdHash = shortHash(cwd);
    const base = cwd === "(unknown cwd)" ? "unknown" : path.basename(cwd) || cwd;
    projects.push({
      key: `${slugify(base)}-${cwdHash}`,
      title: base,
      cwd,
      updated_at: entries[0]?.updated_at || null,
      thread_count: entries.length,
      thread_ids: entries.map((entry) => entry.id),
      recent_threads: entries.slice(0, 5).map((entry) => ({
        id: entry.id,
        title: entry.title,
        updated_at: entry.updated_at
      }))
    });
  }

  projects.sort(compareDescByUpdatedAt);
  return projects;
}

async function writeManifest(manifest) {
  await fsp.mkdir(STATE_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

async function syncManifest(manifest, options) {
  const { ApiClient } = await loadHappyCoderLib();
  const credentials = await readHappyCredentials();
  const settings = await readHappySettings();
  const machineId = settings.machineId;

  if (!machineId) {
    throw new Error(`Happy machineId not found in ${HAPPY_SETTINGS_FILE}`);
  }

  const api = await ApiClient.create(credentials);
  const result = {
    threads: 0,
    projects: 0
  };

  const threadEntries = options.skipThreads
    ? []
    : manifest.threads.slice(0, options.limit);
  const projectEntries = options.skipProjects
    ? []
    : manifest.projects.slice(0, options.limit);

  for (const thread of threadEntries) {
    const metadata = buildThreadMetadata(thread, machineId);
    const initialState = buildInitialState("thread", thread.id);
    await upsertHappySession(api, {
      tag: `local-codex-thread:${thread.id}`,
      metadata,
      initialState,
      message: buildThreadAnnouncement(thread)
    });
    result.threads += 1;
  }

  for (const project of projectEntries) {
    const metadata = buildProjectMetadata(project, machineId);
    const initialState = buildInitialState("project", project.key);
    await upsertHappySession(api, {
      tag: `local-codex-project:${project.key}`,
      metadata,
      initialState,
      message: buildProjectAnnouncement(project)
    });
    result.projects += 1;
  }

  return result;
}

async function loadHappyCoderLib() {
  try {
    return await import(pathToFileURL(path.resolve(HAPPY_CODER_LIB)).href);
  } catch (error) {
    throw new Error(`Unable to load happy-coder library from ${HAPPY_CODER_LIB}: ${error.message}`);
  }
}

async function upsertHappySession(api, sessionSpec) {
  const session = await api.getOrCreateSession({
    tag: sessionSpec.tag,
    metadata: sessionSpec.metadata,
    state: sessionSpec.initialState
  });

  const client = api.sessionSyncClient(session);
  const shouldAnnounce = session.agentState?.announcementSent !== true;

  client.updateMetadata(() => sessionSpec.metadata);
  client.updateAgentState((current = {}) => ({
    ...current,
    ...sessionSpec.initialState,
    announcementSent: current.announcementSent === true
  }));

  if (shouldAnnounce) {
    client.sendCodexMessage({
      type: "message",
      id: randomUUID(),
      message: sessionSpec.message
    });
    client.updateAgentState((current = {}) => ({
      ...current,
      ...sessionSpec.initialState,
      announcementSent: true
    }));
  }

  await sleep(400);
  await client.flush();
  await client.close();
}

function buildThreadMetadata(thread, machineId) {
  const now = Date.now();
  return {
    path: thread.cwd || os.homedir(),
    host: os.hostname(),
    version: "local-codex-sync/1",
    os: os.platform(),
    machineId,
    homeDir: os.homedir(),
    happyHomeDir: HAPPY_HOME,
    happyLibDir: null,
    happyToolsDir: null,
    startedFromDaemon: false,
    hostPid: process.pid,
    startedBy: "local-codex-sync",
    lifecycleState: "archived",
    lifecycleStateSince: now,
    archivedBy: "local-codex-sync",
    archiveReason: "Imported local Codex thread",
    flavor: "codex",
    title: thread.title,
    summary: {
      text: `Imported local Codex thread ${thread.id}`,
      updatedAt: now
    },
    localCodex: {
      sessionId: thread.id,
      sessionFile: thread.session_file,
      updatedAt: thread.updated_at,
      originator: thread.originator,
      cliVersion: thread.cli_version
    }
  };
}

function buildProjectMetadata(project, machineId) {
  const now = Date.now();
  return {
    path: project.cwd === "(unknown cwd)" ? os.homedir() : project.cwd,
    host: os.hostname(),
    version: "local-codex-sync/1",
    os: os.platform(),
    machineId,
    homeDir: os.homedir(),
    happyHomeDir: HAPPY_HOME,
    happyLibDir: null,
    happyToolsDir: null,
    startedFromDaemon: false,
    hostPid: process.pid,
    startedBy: "local-codex-sync",
    lifecycleState: "archived",
    lifecycleStateSince: now,
    archivedBy: "local-codex-sync",
    archiveReason: "Imported local Codex project hub",
    flavor: "codex",
    title: `Project hub: ${project.title}`,
    summary: {
      text: `Imported local Codex project ${project.title}`,
      updatedAt: now
    },
    localCodexProject: {
      key: project.key,
      cwd: project.cwd,
      threadCount: project.thread_count,
      updatedAt: project.updated_at
    }
  };
}

function buildInitialState(kind, key) {
  return {
    controlledByUser: false,
    imported: true,
    importedKind: kind,
    importedKey: key,
    announcementSent: false,
    lastSyncedAt: new Date().toISOString()
  };
}

function buildThreadAnnouncement(thread) {
  return [
    "Imported local Codex thread into Happy.",
    `Title: ${thread.title}`,
    `Local session id: ${thread.id}`,
    `Project: ${thread.cwd || "(unknown cwd)"}`,
    `Updated at: ${thread.updated_at || "(unknown)"}`,
    `Session file: ${thread.session_file || "(missing)"}`
  ].join("\n");
}

function buildProjectAnnouncement(project) {
  const recent = project.recent_threads
    .map((entry) => `- ${entry.title} (${entry.id})`)
    .join("\n");
  return [
    "Imported local Codex project hub into Happy.",
    `Project: ${project.title}`,
    `Path: ${project.cwd}`,
    `Thread count: ${project.thread_count}`,
    "Recent threads:",
    recent || "- none"
  ].join("\n");
}

async function readHappyCredentials() {
  if (!fs.existsSync(HAPPY_ACCESS_FILE)) {
    throw new Error(`Happy credentials not found: ${HAPPY_ACCESS_FILE}`);
  }

  const raw = JSON.parse(await fsp.readFile(HAPPY_ACCESS_FILE, "utf8"));
  if (raw.secret) {
    return {
      token: raw.token,
      encryption: {
        type: "legacy",
        secret: new Uint8Array(Buffer.from(raw.secret, "base64"))
      }
    };
  }
  if (raw.encryption?.publicKey && raw.encryption?.machineKey) {
    return {
      token: raw.token,
      encryption: {
        type: "dataKey",
        publicKey: new Uint8Array(Buffer.from(raw.encryption.publicKey, "base64")),
        machineKey: new Uint8Array(Buffer.from(raw.encryption.machineKey, "base64"))
      }
    };
  }
  throw new Error(`Happy credentials in ${HAPPY_ACCESS_FILE} are not in a supported format`);
}

async function readHappySettings() {
  if (!fs.existsSync(HAPPY_SETTINGS_FILE)) {
    throw new Error(`Happy settings not found: ${HAPPY_SETTINGS_FILE}`);
  }
  return JSON.parse(await fsp.readFile(HAPPY_SETTINGS_FILE, "utf8"));
}

function printThreads(manifest) {
  for (const thread of manifest.threads) {
    console.log(
      `${thread.key}\t${thread.id}\t${thread.updated_at || "-"}\t${thread.cwd || "-"}\t${thread.title}`
    );
  }
}

function printProjects(manifest) {
  for (const project of manifest.projects) {
    console.log(
      `${project.key}\t${project.updated_at || "-"}\t${project.cwd}\t${project.thread_count}\t${project.title}`
    );
  }
}

async function launchHappyInDirectory(cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HAPPY_CODEX_REMOTE_FIX], {
      cwd,
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`patched happy codex exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function printSyncSummary(manifest, dryRun, syncResult = null) {
  console.log(`Manifest: ${MANIFEST_FILE}`);
  console.log(`Generated at: ${manifest.generated_at}`);
  console.log(`Threads: ${manifest.threads.length}`);
  console.log(`Projects: ${manifest.projects.length}`);

  if (dryRun) {
    console.log("Mode: dry-run");
    return;
  }

  console.log(`Synced threads: ${syncResult?.threads ?? 0}`);
  console.log(`Synced projects: ${syncResult?.projects ?? 0}`);
}

function compareDescByUpdatedAt(left, right) {
  const leftValue = Date.parse(left.updated_at || 0);
  const rightValue = Date.parse(right.updated_at || 0);
  return rightValue - leftValue;
}

function expandHome(value) {
  if (!value.startsWith("~")) {
    return value;
  }
  return path.join(os.homedir(), value.slice(1));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function parseLimit(value) {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
