import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { AllyAtWork, type AllyAtWorkMode } from "@/components/AllyAtWork";
import { AnalysePeek } from "@/components/AnalysePeek";
import { useAuth } from "@/hooks/useAuth";
import { STEP_LABEL, STEP_STATUS_LINE } from "@/lib/canvasCopy";
import type { Analysis, SubStep } from "@shared/schema";

// Phase 1, Analyse step. Renders AllyAtWork while a fresh analysis is in
// flight (kicked off by StepController, manual /refresh, or chat triggerRefresh).
//
// Peek mode: when navigated here while the user's natural sub-step is past
// this step AND no analysis is currently in progress, render the static
// historical recap (AnalysePeek) — never lie that work is in flight.
//
// In-progress trumps peek: if the in-progress poll finds an `analysing` row,
// the work IS happening right now (e.g. user just clicked the StepController
// CTA to re-read), so render AllyAtWork regardless of peek.
export function PictureDraft({
  subStep,
  peek,
  onBackToCurrent,
}: {
  subStep: SubStep;
  peek?: boolean;
  onBackToCurrent?: () => void;
}) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";

  const retry = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStep.id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] }),
  });

  // Detect whether a fresh analysis is in flight. Polled every 2.5s while we
  // think there might be one (and also after a brief delay so a kick-off
  // initiated milliseconds earlier is visible immediately).
  const inProgressQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/in-progress"],
    refetchInterval: 2500,
  });
  const isWorking = !!inProgressQ.data;

  const mode: AllyAtWorkMode = subStep.errorMessage ? "hit_problem" : "working";

  const steps: PhaseStep[] = [
    { key: "gather", label: STEP_LABEL.picture.gather.title, status: "past", caption: "done" },
    {
      key: "draft",
      label: STEP_LABEL.picture.draft.title,
      status: "current",
      caption: mode === "hit_problem" ? "hit a snag" : "in progress",
    },
    { key: "discuss", label: STEP_LABEL.picture.discuss.title, status: "future", caption: "opens when I'm done" },
    { key: "live", label: STEP_LABEL.picture.live.title, status: "future", caption: "—" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneHeader
        avatar={
          <UserAvatar
            photoUrl={user?.photoDataUrl ?? user?.profileImageUrl}
            initials={getInitials(user?.firstName, user?.lastName, user?.email)}
          />
        }
        name={displayName}
        statusLine={<span className="text-muted-foreground">{STEP_STATUS_LINE.picture.draft}</span>}
      />
      <div className="flex-1 min-h-0 overflow-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {peek && !isWorking ? (
          <AnalysePeek canvas="picture" onSeeResult={onBackToCurrent} />
        ) : (
          <AllyAtWork
            mode={mode}
            title={displayName ? `Reading your year, ${displayName}…` : "Reading across everything you've shared…"}
            expectedSeconds={75}
            rotatorLabel="While I read · a short story"
            canvas="picture"
            errorMessage={subStep.errorMessage}
            onRetry={() => retry.mutate()}
          />
        )}
      </div>
      <PhaseActionBar
        primary={
          peek && !isWorking
            ? { label: "Back to current →", onClick: onBackToCurrent ?? (() => {}) }
            : undefined
        }
      />
    </div>
  );
}
