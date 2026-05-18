import { GoogleGenAI } from '@google/genai';
import type { ChatProvider, ChatOptions, ChatChunk, ProviderInfo } from './types';

const MODELS = [
  { id: 'gemini-2.0-flash',        displayName: 'Gemini 2.0 Flash',  inputPerMTokens: 0.075, outputPerMTokens: 0.30, supportsJsonMode: true },
  { id: 'gemini-2.0-flash-thinking-exp', displayName: 'Gemini 2.0 Flash Thinking', inputPerMTokens: 0.075, outputPerMTokens: 0.30, supportsJsonMode: false },
  { id: 'gemini-2.5-pro',          displayName: 'Gemini 2.5 Pro',    inputPerMTokens: 1.25,  outputPerMTokens: 5.0,  supportsJsonMode: true },
] as const;

const INFO: ProviderInfo = {
  name: 'GOOGLE',
  displayName: 'Google (Gemini)',
  models: [...MODELS],
  defaultModel: 'gemini-2.0-flash',
};

export const GoogleProvider: ChatProvider = {
  info: INFO,

  async *chatStream(opts: ChatOptions, apiKey: string): AsyncIterable<ChatChunk> {
    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = opts.messages.find((m) => m.role === 'system')?.content;
    const chatHistory = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const stream = await ai.models.generateContentStream({
      model: opts.model,
      contents: chatHistory,
      config: {
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
        ...(opts.jsonMode
          ? {
              responseMimeType: 'application/json',
              ...(opts.jsonMode.schema ? { responseSchema: opts.jsonMode.schema as object } : {}),
            }
          : {}),
      },
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { delta: text };
      const usage = chunk.usageMetadata;
      if (usage) {
        inputTokens = usage.promptTokenCount ?? inputTokens;
        outputTokens = usage.candidatesTokenCount ?? outputTokens;
      }
    }
    yield { delta: '', done: true, usage: { inputTokens, outputTokens } };
  },

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
    return (
      (inputTokens / 1_000_000) * m.inputPerMTokens +
      (outputTokens / 1_000_000) * m.outputPerMTokens
    );
  },
};
