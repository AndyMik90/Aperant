/**
 * Edit File Tool
 * ==============
 *
 * Performs exact string replacements in files.
 * Supports single replacement (default) and replace_all mode.
 * Integrates with path-containment security.
 */

import * as fs from 'node:fs';
import { z } from 'zod/v3';

import { assertPathContained } from '../../security/path-containment';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  file_path: z
    .string()
    .describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with (must be different from old_string)'),
  replace_all: z
    .boolean()
    .default(false)
    .describe('Replace all occurrences of old_string (default false)'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const editTool = Tool.define({
  metadata: {
    name: 'Edit',
    description:
      'Performs exact string replacements in files. The edit will FAIL if old_string is not unique in the file (unless replace_all is true). Provide enough surrounding context in old_string to make it unique.',
    permission: ToolPermission.RequiresApproval,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context) => {
    const { file_path, old_string, new_string, replace_all } = input;

    // Security: ensure path is within project boundary
    const { resolvedPath } = assertPathContained(file_path, context.projectDir);

    // Validate inputs
    if (old_string === new_string) {
      return 'Error: old_string and new_string are identical. No changes needed.';
    }

    // Read the file
    let content: string;
    try {
      content = fs.readFileSync(resolvedPath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return `Error: File not found: ${file_path}`;
      }
      throw err;
    }

    // Check old_string exists
    if (!content.includes(old_string)) {
      return `Error: old_string not found in ${file_path}. Make sure the string matches exactly, including whitespace and indentation.`;
    }

    // Check uniqueness when not using replace_all
    if (!replace_all) {
      const occurrences = content.split(old_string).length - 1;
      if (occurrences > 1) {
        return `Error: old_string appears ${occurrences} times in ${file_path}. Provide more context to make it unique, or use replace_all: true to replace all occurrences.`;
      }
    }

    // Perform replacement
    let newContent: string;
    if (replace_all) {
      newContent = content.split(old_string).join(new_string);
    } else {
      // Replace first occurrence only
      const index = content.indexOf(old_string);
      newContent =
        content.slice(0, index) +
        new_string +
        content.slice(index + old_string.length);
    }

    fs.writeFileSync(resolvedPath, newContent, 'utf-8');

    if (replace_all) {
      const count = content.split(old_string).length - 1;
      return `Successfully replaced ${count} occurrence(s) in ${file_path}`;
    }

    return `Successfully edited ${file_path}`;
  },
});
