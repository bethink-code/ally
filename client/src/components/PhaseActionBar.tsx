import type { ReactNode } from "react";

// Pinned-bottom action bar. Three columns:
//   left   — secondary (soft, optional, e.g. "Something's not right")
//   center — tertiary (slot for in-flight artefact actions like Refresh)
//   right  — primary (the forward CTA)
//
// The mini-timeline used to live here; it moved to PaneHeader's `steps`
// prop. The foot is now action-only.

export type PhaseStep = {
  key: string;
  label: string;
  status: "past" | "current" | "future";
  // Short caption under the label — e.g. "done", "4 of 7", "dated 24 apr".
  caption?: string;
};

export function PhaseActionBar({
  primary,
  secondary,
  tertiary,
}: {
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  /** Free slot for an action like Refresh. Caller renders the JSX so it
   *  can carry its own state (refreshing, pulse indicator, etc.). */
  tertiary?: ReactNode;
}) {
  return (
    <div className="shrink-0 bg-foreground text-background">
      <div className="grid grid-cols-3 items-center gap-6 px-6 py-4 min-h-[70px]">
        <div className="flex justify-start">
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className="px-3 py-2 text-xs text-background/70 hover:text-background disabled:opacity-60 transition-colors"
            >
              {secondary.label}
            </button>
          )}
        </div>
        <div className="flex justify-center">{tertiary}</div>
        <div className="flex justify-end">
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="h-10 px-5 py-2 text-sm rounded-md bg-accent text-accent-foreground font-medium disabled:opacity-60 transition-colors hover:bg-accent/90"
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
