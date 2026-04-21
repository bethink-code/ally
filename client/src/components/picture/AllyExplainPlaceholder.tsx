import { Button } from "@/components/ui/button";

// Placeholder for Explain mode — shown in Phase 1 so the mode switcher is visible and discoverable.
// Phase 2 replaces this with real evidence rendering (charts, transaction drilldowns, worked examples)
// triggered by clicking highlighted phrases in the Story.
export function AllyExplainPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <main className="flex-1 overflow-y-auto px-6 py-10 min-h-0 space-y-4">
        <div className="font-serif text-lg text-foreground/80">Explain mode isn't wired up yet.</div>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          Soon, clicking a highlighted phrase in your picture will bring the evidence over here — a chart, a list of transactions, a worked example. For now, back to chat.
        </p>
      </main>
      <div className="border-t border-border px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← back to chat
        </Button>
      </div>
    </div>
  );
}
