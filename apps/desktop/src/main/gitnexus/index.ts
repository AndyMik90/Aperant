/**
 * GitNexus integration utilities
 *
 * Provides helpers for checking index staleness and triggering
 * background re-indexing of the codebase knowledge graph.
 */

import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";

/** Maximum age (in hours) before we consider the index stale */
const STALENESS_THRESHOLD_HOURS = 24;

/**
 * Check whether a GitNexus index exists for the given project.
 */
export function hasGitNexusIndex(projectPath: string): boolean {
  return existsSync(path.join(projectPath, ".gitnexus"));
}

/**
 * Check whether the GitNexus index is stale (older than threshold).
 * Returns `true` if the index exists but is older than STALENESS_THRESHOLD_HOURS,
 * or `false` if the index is fresh or doesn't exist.
 */
export function isIndexStale(projectPath: string): boolean {
  const indexDir = path.join(projectPath, ".gitnexus");
  if (!existsSync(indexDir)) return false;

  try {
    const stats = statSync(indexDir);
    const ageMs = Date.now() - stats.mtimeMs;
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours > STALENESS_THRESHOLD_HOURS;
  } catch {
    return false;
  }
}

/**
 * Trigger a background GitNexus re-index for the given project path.
 * Runs `gitnexus analyze` in a detached child process so it doesn't
 * block the Electron main process.
 *
 * @returns `true` if the process was spawned, `false` if gitnexus isn't available
 */
export function reindexInBackground(projectPath: string): boolean {
  try {
    const child = spawn("gitnexus", ["analyze"], {
      cwd: projectPath,
      stdio: "ignore",
      detached: true,
    });

    // Unref so the Electron process doesn't wait for it
    child.unref();

    console.log(
      `[GitNexus] Background re-index started for: ${projectPath}`,
    );
    return true;
  } catch {
    console.log("[GitNexus] Failed to spawn gitnexus analyze");
    return false;
  }
}

/**
 * Re-index if the project has an existing GitNexus index.
 * Intended for use after task completion — only re-indexes projects
 * that already have an index (doesn't create one from scratch).
 */
export function reindexIfNeeded(projectPath: string): boolean {
  if (!hasGitNexusIndex(projectPath)) return false;
  return reindexInBackground(projectPath);
}

/**
 * Check staleness and trigger background re-index if needed.
 * Intended for use on project open — checks if index is stale
 * and triggers a re-index if so.
 */
export function checkAndReindexIfStale(projectPath: string): boolean {
  if (!hasGitNexusIndex(projectPath)) return false;
  if (!isIndexStale(projectPath)) return false;

  console.log(
    `[GitNexus] Index is stale for ${projectPath}, triggering re-index`,
  );
  return reindexInBackground(projectPath);
}
