// OpenAI Chat Completions type definitions (subset needed for translation)

export interface ChatCompletionsPayload {
  model: string;
  messages: Message[];
  max_tokens?: number | null;
  stop?: string | string[] | null;
  stream?: boolean | null;
  temperature?: number | null;
  top_p?: number | null;
  user?: string | null;
  tools?: Tool[] | null;
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null;
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer";
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ContentPart = TextPart | ImagePart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

// Response types

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChoiceNonStreaming[];
  usage?: Usage;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChoiceStreaming[];
  usage?: Usage;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: {
    accepted_prediction_tokens: number;
    rejected_prediction_tokens: number;
  };
}

interface ChoiceNonStreaming {
  index: number;
  message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
}

interface ChoiceStreaming {
  index: number;
  delta: {
    content?: string | null;
    role?: string;
    tool_calls?: {
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}
