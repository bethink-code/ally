import type { ReactNode } from "react";
import { PaneHeader } from "./PaneHeader";

// Header for the left (content) pane — describes the step the user is on.
// Step number on the left, task title + optional subtitle. This replaces the
// earlier "user's face + name" header: the left pane is a content pane, not a
// person. The mirror lives in the top bar where it belongs.
export function ContentPaneHeader({
  step,
  title,
  subtitle,
  right,
}: {
  step: number;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <PaneHeader
      avatar={<StepBadge n={step} />}
      name={title}
      statusLine={subtitle ?? ""}
      right={right}
    />
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="h-10 w-10 rounded-full border border-accent/50 bg-background flex items-center justify-center font-serif text-xl text-accent flex-shrink-0">
      {n}
    </div>
  );
}
