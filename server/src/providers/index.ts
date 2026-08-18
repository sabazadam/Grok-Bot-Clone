import { getSetting } from '../db.js';
import { anthropicProvider } from './anthropic.js';
import { makeOpenAiProvider } from './openai.js';
import { mockProvider } from './mock.js';
import type { Provider, ProviderConfig } from './types.js';

export interface ProviderMeta {
  id: string;
  label: string;
  models: string[];
  needsKey: boolean;
  needsBaseUrl: boolean;
  envVar?: string;
  defaultBaseUrl?: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    needsKey: true,
    needsBaseUrl: false,
    envVar: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    needsKey: true,
    needsBaseUrl: false,
    envVar: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    models: ['grok-4', 'grok-4-fast', 'grok-3'],
    needsKey: true,
    needsBaseUrl: false,
    envVar: 'XAI_API_KEY',
    defaultBaseUrl: 'https://api.x.ai/v1',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'x-ai/grok-4'],
    needsKey: true,
    needsBaseUrl: false,
    envVar: 'OPENROUTER_API_KEY',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    models: ['llama3.3', 'qwen2.5vl', 'mistral-small3.1'],
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    models: [],
    needsKey: false,
    needsBaseUrl: true,
  },
  {
    id: 'mock',
    label: 'Mock (offline demo)',
    models: ['scripted-demo'],
    needsKey: false,
    needsBaseUrl: false,
  },
];

const implementations: Record<string, Provider> = {
  anthropic: anthropicProvider,
  openai: makeOpenAiProvider('https://api.openai.com/v1', true),
  xai: makeOpenAiProvider('https://api.x.ai/v1', true),
  openrouter: makeOpenAiProvider('https://openrouter.ai/api/v1', true),
  ollama: makeOpenAiProvider('http://localhost:11434/v1', false),
  custom: makeOpenAiProvider('http://localhost:8000/v1', false),
  mock: mockProvider,
};

export function getProviderMeta(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getProvider(id: string): Provider {
  const impl = implementations[id];
  if (!impl) throw new Error(`unknown provider: ${id}`);
  return impl;
}

export function resolveApiKey(id: string): string | undefined {
  const meta = getProviderMeta(id);
  const fromSettings = getSetting(`apikey:${id}`);
  if (fromSettings) return fromSettings;
  if (meta?.envVar && process.env[meta.envVar]) return process.env[meta.envVar];
  return undefined;
}

export function resolveConfig(id: string): ProviderConfig {
  const meta = getProviderMeta(id);
  return {
    apiKey: resolveApiKey(id),
    baseUrl: getSetting(`baseurl:${id}`) ?? meta?.defaultBaseUrl,
  };
}
