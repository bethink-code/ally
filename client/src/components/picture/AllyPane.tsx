import { useState } from "react";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { AllyAvatar } from "@/components/layout/Avatars";
import { AllyChat } from "./AllyChat";
import { AllyExplainPlaceholder } from "./AllyExplainPlaceholder";
import { AllyNotesPlaceholder } from "./AllyNotesPlaceholder";

type Mode = "chat" | "explain" | "notes";

const stateLineByMode: Record<Mode, { label: string; tone: string }> = {
  chat: { label: "in chat", tone: "text-emerald-700" },
  explain: { label: "explaining", tone: "text-amber-700" },
  notes: { label: "notes", tone: "text-purple-700" },
};

// Ally's pane — right side of the two-pane layout. Always present.
// Owns the mode state (chat / explain / notes). Phase 1 ships the three-pill switcher and Chat
// is the only live mode; Explain and Notes render a placeholder with a "back to chat" action.
export function AllyPane() {
  const [mode, setMode] = useState<Mode>("chat");
  const stateLine = stateLineByMode[mode];

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneHeader
        avatar={<AllyAvatar />}
        name="Ally"
        statusLine={<span className={stateLine.tone}>{stateLine.label}</span>}
        right={<ModeSwitcher mode={mode} onChange={setMode} />}
      />
      <div className="flex-1 min-h-0">
        {mode === "chat" && <AllyChat />}
        {mode === "explain" && <AllyExplainPlaceholder onBack={() => setMode("chat")} />}
        {mode === "notes" && <AllyNotesPlaceholder onBack={() => setMode("chat")} />}
      </div>
    </div>
  );
}

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5 text-xs">
      <ModePill label="chat" active={mode === "chat"} onClick={() => onChange("chat")} />
      <ModePill label="explain" active={mode === "explain"} onClick={() => onChange("explain")} />
      <ModePill label="notes" active={mode === "notes"} onClick={() => onChange("notes")} />
    </div>
  );
}

function ModePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full transition-colors ${
        active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
