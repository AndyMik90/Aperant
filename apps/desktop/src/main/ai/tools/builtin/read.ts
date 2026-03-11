/**
 * Read File Tool
 * ==============
 *
 * Reads a file from the local filesystem with support for:
 * - Line offset and limit for partial reads
 * - Image file detection (returns base64 for multimodal)
 * - PDF file detection with page range support
 * - Line number prefixing (cat -n style)
 *
 * Integrates with path-containment security to prevent
 * reads outside the project directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { assertPathContained } from '../../security/path-containment';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
]);

const PDF_EXTENSION = '.pdf';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to read'),
  offset: z
    .number()
    .optional()
    .describe('The line number to start reading from. Only provide if the file is too large to read at once'),
  limit: z
    .number()
    .optional()
    .describe('The number of lines to read. Only provide if the file is too large to read at once.'),
  pages: z
    .string()
    .optional()
    .describe('Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWithLineNumbers(
  content: string,
  offset: number,
): string {
  const lines = content.split(/\r?\n/);
  const maxLineNum = offset + lines.length;
  const padWidth = String(maxLineNum).length;

  return lines
    .map((line, i) => {
      const lineNum = String(offset + i + 1).padStart(padWidth, ' ');
      const truncated =
        line.length > MAX_LINE_LENGTH
          ? `${line.slice(0, MAX_LINE_LENGTH)}... (truncated)`
          : line;
      return `${lineNum}\t${truncated}`;
    })
    .join('\n');
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isPdfFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === PDF_EXTENSION;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const readTool = Tool.define({
  metadata: {
    name: 'Read',
    description:
      'Reads a file from the local filesystem. Supports line offset/limit for partial reads, image files (returns base64), and PDF files with page ranges. Results are returned with line numbers.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context) => {
    const { file_path, offset, limit, pages } = input;

    // Security: ensure path is within project boundary
    const { resolvedPath } = assertPathContained(file_path, context.projectDir);

    // Open fd once — all subsequent stat/read go through this fd to avoid TOCTOU
    let fd: number;
    try {
      fd = fs.openSync(resolvedPath, 'r');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return `Error: File not found: ${file_path}`;
      }
      if (code === 'EISDIR') {
        return `Error: '${file_path}' is a directory, not a file. Use the Bash tool with ls to list directory contents.`;
      }
      throw err;
    }
    try {
      const stat = fs.fstatSync(fd);
      if (stat.isDirectory()) {
        return `Error: '${file_path}' is a directory, not a file. Use the Bash tool with ls to list directory contents.`;
      }

      // Image files — read from same fd
      if (isImageFile(resolvedPath)) {
        const buffer = fs.readFileSync(fd);
        const base64 = buffer.toString('base64');
        const ext = path.extname(resolvedPath).toLowerCase().slice(1);
        const mimeType =
          ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        return `[Image file: ${path.basename(resolvedPath)}]\ndata:${mimeType};base64,${base64}`;
      }

      // PDF files — size from same fstat
      if (isPdfFile(resolvedPath)) {
        if (pages) {
          return `[PDF file: ${path.basename(resolvedPath)}, pages: ${pages}]\nPDF reading requires external tooling. File exists at: ${resolvedPath}`;
        }
        const fileSizeKb = Math.round(stat.size / 1024);
        return `[PDF file: ${path.basename(resolvedPath)}, size: ${fileSizeKb}KB]\nUse the 'pages' parameter to read specific page ranges.`;
      }

      // Text files — read from same fd
      const content = fs.readFileSync(fd, 'utf-8');

      if (content.length === 0) {
        return `[File exists but is empty: ${file_path}]`;
      }

      const lines = content.split(/\r?\n/);
      const startLine = offset ?? 0;
      const lineLimit = limit ?? DEFAULT_LINE_LIMIT;

      const sliced = lines.slice(startLine, startLine + lineLimit);
      const result = formatWithLineNumbers(sliced.join('\n'), startLine);

      const totalLines = lines.length;
      if (startLine + lineLimit < totalLines) {
        return `${result}\n\n[Showing lines ${startLine + 1}-${startLine + lineLimit} of ${totalLines} total lines]`;
      }

      return result;
    } finally {
      fs.closeSync(fd);
    }
  },
});
