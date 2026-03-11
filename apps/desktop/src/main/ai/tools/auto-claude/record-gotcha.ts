/**
 * record_gotcha Tool
 * ==================
 *
 * Records a gotcha or pitfall to specDir/memory/gotchas.md.
 * See apps/desktop/src/main/ai/tools/auto-claude/record-gotcha.ts for the TypeScript implementation.
 *
 * Tool name: mcp__auto-claude__record_gotcha
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  gotcha: z.string().describe('Description of the gotcha or pitfall to record'),
  context: z
    .string()
    .optional()
    .describe('Additional context about when this gotcha applies'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const recordGotchaTool = Tool.define({
  metadata: {
    name: 'mcp__auto-claude__record_gotcha',
    description:
      'Record a gotcha or pitfall to avoid. Use this when you encounter something that future sessions should know about to avoid repeating mistakes.',
    permission: ToolPermission.Auto,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: (input, context) => {
    const { gotcha, context: ctx } = input;
    const memoryDir = path.join(context.specDir, 'memory');

    try {
      fs.mkdirSync(memoryDir, { recursive: true });

      const gotchasFile = path.join(memoryDir, 'gotchas.md');
      const now = new Date();
      const timestamp = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;

      // Determine whether file is new or empty without a separate existsSync check
      let isNew: boolean;
      try {
        const stat = fs.statSync(gotchasFile);
        isNew = stat.size === 0;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        isNew = true;
      }
      const header = isNew ? '# Gotchas & Pitfalls\n\nThings to watch out for in this codebase.\n' : '';

      let entry = `\n## [${timestamp}]\n${gotcha}`;
      if (ctx) {
        entry += `\n\n_Context: ${ctx}_`;
      }
      entry += '\n';

      fs.writeFileSync(gotchasFile, header + entry, { flag: isNew ? 'w' : 'a', encoding: 'utf-8' });

      return `Recorded gotcha: ${gotcha}`;
    } catch (e) {
      return `Error recording gotcha: ${e}`;
    }
  },
});
