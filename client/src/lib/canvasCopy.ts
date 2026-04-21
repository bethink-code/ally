// Single source of truth for canvas-level copy — pill labels, sentence verbs,
// card state captions, narration templates. Change copy here, not in components.

export type CanvasKey = "picture" | "analysis" | "plan" | "progress";

export const CANVAS_KEYS: CanvasKey[] = ["picture", "analysis", "plan", "progress"];

// The short label shown inside the pill itself ("your financial snapshot", etc.).
// Lowercase — it's mid-sentence. Never italicised.
export const CANVAS_PILL_LABEL: Record<CanvasKey, string> = {
  picture: "your financial snapshot",
  analysis: "our analysis",
  plan: "your plan",
  progress: "your progress",
};

// Verb phrase used in the top-bar sentence: "Hi {name}. We're {verb} {pill}".
export const CANVAS_SENTENCE_VERB: Record<CanvasKey, string> = {
  picture: "working on",
  analysis: "looking at",
  plan: "building",
  progress: "watching",
};

// Title-case label shown on the canvas cards in the megamenu (and in section headings).
export const CANVAS_CARD_TITLE: Record<CanvasKey, string> = {
  picture: "Your financial snapshot",
  analysis: "Our analysis",
  plan: "Your plan",
  progress: "Your progress",
};

// State of each canvas relative to the user's journey. Only `current` is interactive
// right now; the rest are visually disabled in Phase 1.
export type CanvasCardState = "current" | "next" | "later" | "dormant";

export const CANVAS_STATE_CAPTION: Record<CanvasCardState, string> = {
  current: "Currently here",
  next: "Unlocks after baseline",
  later: "After analysis",
  dormant: "Lights up when you have a plan",
};

// For the active canvas only. Returns current/next/later/dormant for every canvas,
// assuming the user is on the given activeCanvas and moving forward linearly.
export function canvasStates(active: CanvasKey): Record<CanvasKey, CanvasCardState> {
  const order: CanvasKey[] = ["picture", "analysis", "plan", "progress"];
  const activeIdx = order.indexOf(active);
  return order.reduce(
    (acc, k, i) => {
      if (i === activeIdx) acc[k] = "current";
      else if (i === activeIdx + 1) acc[k] = "next";
      else if (k === "progress") acc[k] = "dormant";
      else acc[k] = "later";
      return acc;
    },
    {} as Record<CanvasKey, CanvasCardState>,
  );
}

// Short label for the canvas tab bar (under each tab title).
export const CANVAS_TAB_CAPTION: Record<CanvasCardState, string> = {
  current: "you're here",
  next: "next",
  later: "later",
  dormant: "dormant",
};

// Stage descriptions for the picture canvas sub-steps.
export const PICTURE_STAGE: Record<
  "bring_it_in" | "first_take_gaps" | "agreed" | "live",
  { title: string; description: string }
> = {
  bring_it_in: {
    title: "Upload docs",
    description: "Your last 12 months of statements — any bank, any format.",
  },
  first_take_gaps: {
    title: "First take & gaps",
    description: "I'll write you a first view and ask about what I can't see.",
  },
  agreed: {
    title: "Agreed",
    description: "We agree this as your baseline — dated, referenceable.",
  },
  live: {
    title: "Live",
    description: "Your picture stays current until something changes.",
  },
};
