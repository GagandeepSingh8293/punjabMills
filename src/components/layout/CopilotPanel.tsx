import { useEffect, useRef } from "react";
import { Sparkles, Send, X, Trash2, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCopilotStore } from "@/stores/copilot";
import { useSidebarStore } from "@/stores/sidebar";

export function CopilotPanel() {
  const open = useSidebarStore((s) => s.copilotOpen);
  const setOpen = useSidebarStore((s) => s.setCopilotOpen);
  const { messages, input, sending, setInput, send, clear } = useCopilotStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  if (!open) return null;

  const submit = () => {
    send();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[520px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-xl border bg-card shadow-2xl animate-in slide-in-from-bottom-6 fade-in-0">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_oklch,var(--info)_15%,transparent)] text-[var(--info)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold leading-tight">DyeAI Copilot</p>
          <p className="text-[11px] leading-tight text-muted-foreground">Answers from your local data</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clear} title="Clear conversation">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div ref={scrollRef} className="space-y-3 p-3">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.role === "user" && "flex-row-reverse")}>
              <span
                className={cn(
                  "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  m.role === "assistant"
                    ? "bg-[color-mix(in_oklch,var(--info)_15%,transparent)] text-[var(--info)]"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {m.role === "assistant" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              </span>
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  m.role === "assistant"
                    ? "bg-muted"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {m.status === "pending" ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                  </span>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about billing, challans, vehicles…"
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={sending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}