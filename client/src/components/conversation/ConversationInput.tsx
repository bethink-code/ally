import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function ConversationInput({
  onSend,
  disabled,
}: {
  onSend: (content: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    setValue(el.value);
  }

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="px-6 py-4 flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onInput={onInput}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder="Your answer…"
          className="flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <Button onClick={submit} disabled={disabled}>
          Send
        </Button>
      </div>
    </div>
  );
}
