#!/usr/bin/env node
/** GrokBot doctor — checks the environment and configuration. Run: node scripts/doctor.mjs */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

let failures = 0;

console.log("\x1b[1mGrokBot doctor\x1b[0m");

// Node
const major = Number(process.versions.node.split(".")[0]);
major >= 20 ? ok(`Node ${process.version}`) : (bad(`Node >= 20 required, found ${process.version}`), failures++);

// Docker
try {
  execSync("docker info", { stdio: "pipe" });
  ok("Docker daemon reachable");
  try {
    execSync("docker image inspect grokbot/agent-desktop:latest", { stdio: "pipe" });
    ok("Agent OS image present (grokbot/agent-desktop:latest)");
  } catch {
    bad("Agent OS image missing — run: npm run image:build");
    failures++;
  }
} catch {
  bad("Docker not running — start Docker Desktop or OrbStack");
  failures++;
}

// .env / API keys
const envPath = path.join(root, ".env");
if (!fs.existsSync(envPath)) {
  warn(".env missing — run: cp .env.example .env  (agents need at least one provider key, or use model 'mock-scripted' to try the pipeline)");
} else {
  const env = fs.readFileSync(envPath, "utf8");
  const has = (k) => new RegExp(`^${k}=.+$`, "m").test(env);
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"].filter(has);
  if (keys.length === 0) {
    warn("No provider API keys set in .env — agents can only use the 'mock-scripted' test model");
  } else {
    ok(`Provider keys configured: ${keys.join(", ")}`);
  }
}

// RAM
const gb = Math.round(os.totalmem() / 1024 ** 3);
const suggested = Math.max(1, Math.floor(gb / 4));
ok(`RAM: ${gb}GB — each agent computer uses ~1-2GB; suggested MAX_RUNNING_COMPUTERS ≤ ${suggested}`);

console.log(failures === 0 ? "\nAll good — run: npm run dev" : `\n${failures} problem(s) found.`);
process.exit(failures === 0 ? 0 : 1);
