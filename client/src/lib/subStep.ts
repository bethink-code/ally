export type PictureSubStep = "bring_it_in" | "first_take_gaps" | "agreed" | "live";

// Pure derivation from user state. Phase 1 only handles the first two; agreed and live are
// placeholders for later phases. If the user has marked Build complete, we're past
// bring-it-in regardless of whether the analysis has finished yet — the first-take-gaps
// component itself handles the "analysis in progress" and "failed" sub-states.
export function getPictureSubStep(user: { buildCompletedAt: unknown } | null | undefined): PictureSubStep {
  if (!user?.buildCompletedAt) return "bring_it_in";
  return "first_take_gaps";
}

export function subStepStatusLine(subStep: PictureSubStep): string {
  switch (subStep) {
    case "bring_it_in":
      return "your picture · bring it in";
    case "first_take_gaps":
      return "your picture · first take & gaps";
    case "agreed":
      return "your picture · agreed";
    case "live":
      return "your picture · live";
  }
}
