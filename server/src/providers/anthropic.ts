import type { ChatRequest, ChatResponse, Part, Provider, ProviderConfig, ToolCall } from './types.js';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: AnthropicBlock[]; is_error?: boolean };

function toBlocks(parts: Part[]): AnthropicBlock[] {
  return parts.map((p): AnthropicBlock => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text };
      case 'image':
        return {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: p.base64 },
        };
      case 'tool_use':
        return { type: 'tool_use', id: p.id, name: p.name, input: p.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: p.toolUseId,
          content: toBlocks(p.content),
          ...(p.isError ? { is_error: true } : {}),
        };
    }
  });
}

export const anthropicProvider: Provider = {
  async chat(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse> {
    if (!cfg.apiKey) throw new Error('Anthropic API key not configured (Settings or ANTHROPIC_API_KEY)');
    const baseUrl = cfg.baseUrl ?? 'https://api.anthropic.com';

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages: req.turns.map((t) => ({ role: t.role, content: toBlocks(t.content) })),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as { content: AnthropicBlock[] };
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }
    return { text: text.trim(), toolCalls };
  },
};
