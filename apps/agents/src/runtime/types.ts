/**
 * Tipos del mini-runtime de agente. Representación propia y agnóstica de
 * proveedor: los adaptadores (OpenAI function-calling para Qwen/vLLM,
 * Anthropic tools para Claude) traducen desde/hacia este contrato.
 */

/** Una herramienta que el modelo puede invocar. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema del input (formato común a OpenAI y Anthropic). */
  inputSchema: Record<string, unknown>;
  /** Ejecuta la tool. El string devuelto es el tool_result que ve el modelo. */
  execute(input: unknown): Promise<string>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos crudos en JSON (se parsean con tolerancia en el loop). */
  arguments: string;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** 'length' = truncado por max tokens del proveedor. */
  stopReason: 'stop' | 'tool_calls' | 'length' | 'other';
}

/** Contrato que implementan los adaptadores de proveedor (HU axon#7). */
export interface LlmProvider {
  complete(opts: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDef[];
    maxOutputTokens?: number;
  }): Promise<CompletionResult>;
}
