#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

function usage() {
  console.log(`usage:
  node scripts/release-repo.mjs preflight <channel> <version> [--repo <owner/repo>]
  node scripts/release-repo.mjs publish <channel> <version> [--repo <owner/repo>]
  node scripts/release-repo.mjs verify <channel> <version> [--repo <owner/repo>]`);
}

function option(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] ?? fallback;
}

function parse(argv) {
  const [command, channel, version, ...rest] = argv;
  if (!command || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }
  if (!channel || !version) {
    throw new Error("channel and version are required");
  }
  if (channel !== "preview") {
    throw new Error(`Unknown release channel ${JSON.stringify(channel)}. Known channel: preview`);
  }
  return {
    command,
    channel,
    version,
    repo: option(rest, "--repo", process.env.KRIYO_RELEASE_REPO_SLUG ?? "kriyo-one/kriyo-releases"),
    pagesDomain: option(rest, "--pages-domain", process.env.KRIYO_RELEASE_PAGES_DOMAIN ?? "updates.kriyo.one"),
  };
}

function tag(channel, version) {
  return `kriyo-${channel}-v${version}`;
}

function incomingRoot(channel, version) {
  return path.join(repoRoot, "_incoming", channel, version);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function listAssets(channel, version) {
  const assetsDir = path.join(incomingRoot(channel, version), "assets");
  if (!fs.existsSync(assetsDir)) {
    return [];
  }
  return fs.readdirSync(assetsDir)
    .filter((entry) => fs.statSync(path.join(assetsDir, entry)).isFile())
    .map((entry) => path.join(assetsDir, entry))
    .sort();
}

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function commandSucceeds(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

function validateStagedRelease({ channel, version, repo }) {
  const releaseTag = tag(channel, version);
  const root = incomingRoot(channel, version);
  const latestPath = path.join(root, "latest.json");
  const manifestPath = path.join(root, "manifest.json");
  const checksumPath = path.join(root, "checksums.sha256");
  const trustPath = path.join(root, "macos-trust.json");
  const notePath = path.join(root, "release-note.md");
  for (const filePath of [latestPath, manifestPath, checksumPath, trustPath, notePath]) {
    assertFile(filePath);
  }
  const assets = listAssets(channel, version);
  if (assets.length === 0) {
    throw new Error(`No staged release assets found under ${path.join(root, "assets")}`);
  }
  const latest = readJson(latestPath);
  const trust = readJson(trustPath);
  if (latest.channel !== channel || latest.version !== version || latest.tag !== releaseTag) {
    throw new Error(`latest.json does not match ${channel} ${version} ${releaseTag}`);
  }
  if (!trust.trustedForPublicPreview) {
    throw new Error("macOS trust evidence is not sufficient for public preview publishing");
  }
  if (commandSucceeds(() => gh(["release", "view", releaseTag, "--repo", repo], { stdio: "ignore" }))) {
    throw new Error(`GitHub Release already exists: ${repo} ${releaseTag}`);
  }
  if (commandSucceeds(() => git(["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${releaseTag}`], { stdio: "ignore" }))) {
    throw new Error(`Git tag already exists on origin: ${releaseTag}`);
  }
  const publicLatestPath = path.join(repoRoot, "docs", "kriyo", channel, "latest.json");
  if (fs.existsSync(publicLatestPath) && readJson(publicLatestPath).version === version) {
    throw new Error(`Public latest.json already points ${channel} at ${version}`);
  }
  return { releaseTag, root, latestPath, checksumPath, trustPath, notePath, assets, latest };
}

function ensureReleaseAnchor() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "kriyo-release-anchor-"));
  const remote = git(["remote", "get-url", "origin"]).trim();
  git(["init"], { cwd: tmp, stdio: "ignore" });
  fs.writeFileSync(
    path.join(tmp, "README.md"),
    "# Kriyo Release Anchor\n\nThis branch exists only to keep GitHub Release source archives minimal.\n",
  );
  git(["add", "README.md"], { cwd: tmp, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Create Kriyo release archive anchor"], {
    cwd: tmp,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Kriyo Release",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "release@kriyo.one",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Kriyo Release",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "release@kriyo.one",
    },
    stdio: "ignore",
  });
  git(["push", remote, "HEAD:refs/heads/release-anchor", "--force"], { cwd: tmp, stdio: "inherit" });
}

function preflight(args) {
  const staged = validateStagedRelease(args);
  console.log(`preflight passed for ${staged.releaseTag}`);
  console.log(`staged assets: ${staged.assets.length}`);
}

function publish(args) {
  const staged = validateStagedRelease(args);
  ensureReleaseAnchor();

  fs.mkdirSync(path.join(repoRoot, "docs", "kriyo", args.channel), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "release-notes", args.channel), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "docs", "CNAME"), `${args.pagesDomain}\n`);
  fs.writeFileSync(path.join(repoRoot, "docs", ".nojekyll"), "");
  fs.copyFileSync(staged.latestPath, path.join(repoRoot, "docs", "kriyo", args.channel, "latest.json"));
  const publicNotePath = path.join(repoRoot, "release-notes", args.channel, `${staged.releaseTag}.md`);
  fs.copyFileSync(staged.notePath, publicNotePath);

  git(["add", "docs/CNAME", "docs/.nojekyll", path.join("docs", "kriyo", args.channel, "latest.json"), publicNotePath], {
    stdio: "inherit",
  });
  git(["commit", "-m", `Publish ${staged.latest.title}`], { stdio: "inherit" });
  git(["push", "origin", "HEAD"], { stdio: "inherit" });

  gh([
    "release",
    "create",
    staged.releaseTag,
    ...staged.assets,
    staged.checksumPath,
    staged.trustPath,
    "--repo",
    args.repo,
    "--target",
    "release-anchor",
    "--title",
    staged.latest.title,
    "--notes-file",
    staged.notePath,
    "--prerelease",
  ], { stdio: "inherit" });
}

function verify(args) {
  const releaseTag = tag(args.channel, args.version);
  gh(["release", "view", releaseTag, "--repo", args.repo], { stdio: "inherit" });
  const latestPath = path.join(repoRoot, "docs", "kriyo", args.channel, "latest.json");
  assertFile(latestPath);
  const latest = readJson(latestPath);
  if (latest.tag !== releaseTag || latest.version !== args.version) {
    throw new Error(`latest.json does not match ${releaseTag}`);
  }
  console.log(`verified ${releaseTag}`);
  console.log(`metadata: https://${args.pagesDomain}/kriyo/${args.channel}/latest.json`);
}

function main() {
  const args = parse(process.argv.slice(2));
  if (args.command === "help") {
    usage();
    return;
  }
  if (args.command === "preflight") {
    preflight(args);
    return;
  }
  if (args.command === "publish") {
    publish(args);
    return;
  }
  if (args.command === "verify") {
    verify(args);
    return;
  }
  throw new Error(`Unknown command ${JSON.stringify(args.command)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
