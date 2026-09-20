export type CopilotMessageRole = "user" | "assistant";

export type CopilotMessageStatus = "pending" | "done" | "error";

export interface CopilotMessage {
  id: string;
  role: CopilotMessageRole;
  content: string;
  status: CopilotMessageStatus;
}