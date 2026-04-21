import { Button } from "@/components/ui/button";

// Placeholder for Notes mode — shown in Phase 1 so the mode switcher is visible and discoverable.
// Phase 2 replaces this with the shared record: structured facts we've established in conversation
// (house bonded, RA at Allan Gray, medical aid through employer), each with provenance and an edit link.
export function AllyNotesPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <main className="flex-1 overflow-y-auto px-6 py-10 min-h-0 space-y-4">
        <div className="font-serif text-lg text-foreground/80">Notes mode isn't wired up yet.</div>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          Soon, everything we've established in conversation will live here — dated, editable, and yours to correct. For now, back to chat.
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
