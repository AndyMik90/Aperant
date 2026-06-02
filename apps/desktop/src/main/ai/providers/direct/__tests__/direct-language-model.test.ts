/**
 * Tests for the Direct provider wrapper: prompt flattening, ReAct tool-call
 * emulation, and the LanguageModelV2 generate/stream surface.
 */

import { describe, expect, it, vi } from 'vitest';
import type { LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider';

import { flattenPrompt } from '../prompt-flatten';
import { buildToolInstructions, parseToolCalls } from '../tool-protocol';
import {
  DirectLanguageModel,
  type DirectTransport,
  type DirectGenerateResult,
} from '../direct-language-model';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A transport that returns a fixed reply and records the prompt it received. */
function fakeTransport(reply: string | DirectGenerateResult): DirectTransport & {
  lastPrompt: string | null;
} {
  return {
    lastPrompt: null,
    async generate(opts) {
      (this as { lastPrompt: string | null }).lastPrompt = opts.prompt;
      const result = typeof reply === 'string' ? { text: reply } : reply;
      if (opts.onText) opts.onText(result.text);
      return result;
    },
  };
}

const READ_TOOL = {
  type: 'function' as const,
  name: 'Read',
  description: 'Read a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
};

function callOptions(
  partial: Partial<LanguageModelV2CallOptions> & Pick<LanguageModelV2CallOptions, 'prompt'>,
): LanguageModelV2CallOptions {
  return partial as LanguageModelV2CallOptions;
}

async function drain(
  stream: ReadableStream<LanguageModelV2StreamPart>,
): Promise<LanguageModelV2StreamPart[]> {
  const parts: LanguageModelV2StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// prompt-flatten
// ---------------------------------------------------------------------------

describe('flattenPrompt', () => {
  it('separates system text from the user/assistant transcript', () => {
    const { system, transcript } = flattenPrompt([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(system).toBe('You are helpful.');
    expect(transcript).toContain('User:\nHi');
    expect(transcript).not.toContain('You are helpful.');
  });

  it('renders prior tool calls and tool results as parseable blocks', () => {
    const { transcript } = flattenPrompt([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'Read', input: { path: 'a.ts' } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'Read',
            output: { type: 'text', value: 'file body' },
          },
        ],
      },
    ]);
    expect(transcript).toContain('<tool_call>');
    expect(transcript).toContain('"name":"Read"');
    expect(transcript).toContain('Tool result (tool="Read", id="c1"):\nfile body');
  });
});

// ---------------------------------------------------------------------------
// tool-protocol
// ---------------------------------------------------------------------------

describe('tool-protocol', () => {
  it('builds instructions only when tools exist', () => {
    expect(buildToolInstructions([])).toBe('');
    const text = buildToolInstructions([READ_TOOL]);
    expect(text).toContain('Read');
    expect(text).toContain('<tool_call>');
  });

  it('extracts a tool call and strips it from the prose', () => {
    const { text, toolCalls } = parseToolCalls(
      'Let me look.\n<tool_call>\n{"name":"Read","arguments":{"path":"a.ts"}}\n</tool_call>',
    );
    expect(text).toBe('Let me look.');
    expect(toolCalls).toEqual([{ toolName: 'Read', args: { path: 'a.ts' } }]);
  });

  it('parses multiple calls and tolerates a fenced variant', () => {
    const { toolCalls } = parseToolCalls(
      '<tool_call>{"name":"A"}</tool_call>\n```tool_call\n{"name":"B","arguments":{"x":1}}\n```',
    );
    expect(toolCalls.map((c) => c.toolName)).toEqual(['A', 'B']);
    expect(toolCalls[0].args).toEqual({}); // missing arguments default to {}
  });

  it('keeps malformed blocks visible rather than swallowing them', () => {
    const { text, toolCalls } = parseToolCalls('<tool_call>not json</tool_call>');
    expect(toolCalls).toHaveLength(0);
    expect(text).toContain('not json');
  });
});

// ---------------------------------------------------------------------------
// DirectLanguageModel.doGenerate
// ---------------------------------------------------------------------------

describe('DirectLanguageModel.doGenerate', () => {
  it('returns plain text content with finishReason "stop" when no tool calls', async () => {
    const model = new DirectLanguageModel({
      provider: 'direct',
      modelId: 'deepseek',
      transport: fakeTransport('Hello there.'),
    });
    const res = await model.doGenerate(
      callOptions({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    );
    expect(res.finishReason).toBe('stop');
    expect(res.content).toEqual([{ type: 'text', text: 'Hello there.' }]);
    expect(res.usage.totalTokens).toBeGreaterThan(0);
  });

  it('emits tool-call content with finishReason "tool-calls"', async () => {
    const model = new DirectLanguageModel({
      provider: 'direct',
      modelId: 'deepseek',
      transport: fakeTransport(
        'Reading.\n<tool_call>{"name":"Read","arguments":{"path":"a.ts"}}</tool_call>',
      ),
    });
    const res = await model.doGenerate(
      callOptions({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'read a.ts' }] }],
        tools: [READ_TOOL],
      }),
    );
    expect(res.finishReason).toBe('tool-calls');
    const toolCall = res.content.find((c) => c.type === 'tool-call');
    expect(toolCall).toMatchObject({ toolName: 'Read', input: '{"path":"a.ts"}' });
  });

  it('injects tool instructions into the prompt when tools are present', async () => {
    const transport = fakeTransport('done');
    const model = new DirectLanguageModel({ provider: 'direct', modelId: 'deepseek', transport });
    await model.doGenerate(
      callOptions({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [READ_TOOL],
      }),
    );
    expect(transport.lastPrompt).toContain('# Tool use');
    expect(transport.lastPrompt).toContain('Assistant:');
  });
});

// ---------------------------------------------------------------------------
// DirectLanguageModel.doStream
// ---------------------------------------------------------------------------

describe('DirectLanguageModel.doStream', () => {
  it('streams text deltas live when no tools are exposed', async () => {
    const model = new DirectLanguageModel({
      provider: 'direct',
      modelId: 'deepseek',
      transport: fakeTransport('streamed answer'),
    });
    const { stream } = await model.doStream(
      callOptions({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    );
    const parts = await drain(stream);
    const types = parts.map((p) => p.type);
    expect(types[0]).toBe('stream-start');
    expect(types).toContain('text-delta');
    const finish = parts.find((p) => p.type === 'finish');
    expect(finish).toMatchObject({ finishReason: 'stop' });
  });

  it('buffers and emits tool-call parts when tools are exposed', async () => {
    const model = new DirectLanguageModel({
      provider: 'direct',
      modelId: 'deepseek',
      transport: fakeTransport('<tool_call>{"name":"Read","arguments":{"path":"a.ts"}}</tool_call>'),
    });
    const { stream } = await model.doStream(
      callOptions({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'read' }] }],
        tools: [READ_TOOL],
      }),
    );
    const parts = await drain(stream);
    const toolCall = parts.find((p) => p.type === 'tool-call');
    expect(toolCall).toMatchObject({ toolName: 'Read' });
    const finish = parts.find((p) => p.type === 'finish');
    expect(finish).toMatchObject({ finishReason: 'tool-calls' });
  });

  it('surfaces transport errors as an error part then finishes', async () => {
    const failing: DirectTransport = {
      async generate() {
        throw new Error('boom');
      },
    };
    const model = new DirectLanguageModel({ provider: 'direct', modelId: 'deepseek', transport: failing });
    const { stream } = await model.doStream(
      callOptions({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    );
    const parts = await drain(stream);
    const err = parts.find((p) => p.type === 'error');
    expect(err).toBeDefined();
    const finish = parts.find((p) => p.type === 'finish');
    expect(finish).toMatchObject({ finishReason: 'error' });
  });

  it('enables reasoning for *-thinking model ids', async () => {
    const transport = fakeTransport('x');
    const spy = vi.spyOn(transport, 'generate');
    const model = new DirectLanguageModel({
      provider: 'direct',
      modelId: 'deepseek-thinking',
      transport,
    });
    await model.doGenerate(
      callOptions({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ thinking: true }));
  });
});
