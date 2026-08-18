import type { ChatRequest, ChatResponse, Part, Provider, ProviderConfig, ToolCall } from './types.js';

/**
 * Adapter for any OpenAI-compatible Chat Completions endpoint:
 * OpenAI, xAI (Grok), OpenRouter, Ollama, vLLM, LM Studio, …
 *
 * Chat Completions cannot carry images inside `role:"tool"` messages, so
 * screenshots inside tool results are re-attached as a follow-up user message.
 */

type OaiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OaiContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

function imagePart(base64: string): OaiContentPart {
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } };
}

function convertTurns(system: string, turns: ChatRequest['turns']): OaiMessage[] {
  const messages: OaiMessage[] = [{ role: 'system', content: system }];

  for (const turn of turns) {
    if (turn.role === 'assistant') {
      let text = '';
      const toolCalls: Extract<OaiMessage, { role: 'assistant' }>['tool_calls'] = [];
      for (const part of turn.content) {
        if (part.type === 'text') text += part.text;
        else if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: { name: part.name, arguments: JSON.stringify(part.input) },
          });
        }
      }
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user turn: may mix plain text/images and tool results
    const userParts: OaiContentPart[] = [];
    const pendingImages: OaiContentPart[] = [];
    for (const part of turn.content) {
      if (part.type === 'text') userParts.push({ type: 'text', text: part.text });
      else if (part.type === 'image') userParts.push(imagePart(part.base64));
      else if (part.type === 'tool_result') {
        let resultText = '';
        for (const inner of part.content) {
          if (inner.type === 'text') resultText += inner.text;
          else if (inner.type === 'image') pendingImages.push(imagePart(inner.base64));
        }
        if (pendingImages.length && !resultText) resultText = '(screenshot attached below)';
        messages.push({
          role: 'tool',
          tool_call_id: part.toolUseId,
          content: (part.isError ? 'ERROR: ' : '') + (resultText || 'ok'),
        });
      }
    }
    if (pendingImages.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: '[Screenshot(s) from the tool result above]' },
          ...pendingImages,
        ],
      });
    }
    if (userParts.length) messages.push({ role: 'user', content: userParts });
  }
  return messages;
}

export function makeOpenAiProvider(defaultBaseUrl: string, requiresKey: boolean): Provider {
  return {
    async chat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse> {
      if (requiresKey && !cfg.apiKey) {
        throw new Error('API key not configured for this provider (see Settings)');
      }
      const baseUrl = (cfg.baseUrl ?? defaultBaseUrl).replace(/\/$/, '');

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 4096,
          messages: convertTurns(req.system, req.turns),
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        }),
        signal: AbortSignal.timeout(300_000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Provider API error ${res.status}: ${body.slice(0, 500)}`);
      }

      const data = (await res.json()) as {
        choices: {
          message: {
            content: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
      };
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error('provider returned no choices');

      const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          input = { _raw: tc.function.arguments };
        }
        return { id: tc.id, name: tc.function.name, input };
      });

      return { text: (message.content ?? '').trim(), toolCalls };
    },
  };
}

export type { Part };
