import { useEffect, useRef } from "react";
import type { ConversationMessage } from "@shared/schema";

export function MessageList({
  messages,
  awaitingReply,
}: {
  messages: ConversationMessage[];
  awaitingReply: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, awaitingReply]);

  return (
    <div className="space-y-8">
      {messages.map((m) => (
        <MessageView key={m.id} message={m} />
      ))}
      {awaitingReply && (
        <div className="text-sm italic text-muted-foreground">Thinking…</div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function MessageView({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-right mb-1">You</div>
          <p className="whitespace-pre-wrap italic leading-relaxed text-sm text-foreground/75 text-right">
            {message.content}
          </p>
        </div>
      </div>
    );
  }
  if (message.isTransition) {
    return (
      <div className="rounded-xl bg-primary/10 border border-primary/20 shadow-sm px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-primary mb-1.5">Checkpoint</div>
        <p className="whitespace-pre-wrap leading-relaxed text-sm text-foreground/90">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <p className="whitespace-pre-wrap leading-relaxed text-sm text-foreground/90">
      {message.content}
    </p>
  );
}
