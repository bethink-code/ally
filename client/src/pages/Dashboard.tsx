import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAuth } from "@/lib/invalidation";
import { useAuth } from "@/hooks/useAuth";
import { TopBar } from "@/components/layout/TopBar";
import { TwoPane } from "@/components/layout/TwoPane";
import { BringItIn } from "@/components/picture/BringItIn";
import { FirstTakeGaps } from "@/components/picture/FirstTakeGaps";
import { AllyPane } from "@/components/picture/AllyPane";
import { getPictureSubStep } from "@/lib/subStep";

// The Your Picture canvas. Phase 1 handles two sub-steps: bring it in and first take & gaps.
// The two-pane grammar is enforced: content on the left, Ally on the right.
// Sub-step components own their own pane headers (including the right-slot actions).
export default function Dashboard() {
  const { user } = useAuth();

  const reopenBuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/build-reopen"),
    onSuccess: () => invalidateAuth(queryClient),
  });

  if (!user) return null;

  const subStep = getPictureSubStep(user);

  return (
    <div className="flex flex-col h-screen">
      <TopBar user={user} activeCanvas="picture" />
      <div className="flex-1 min-h-0">
        <TwoPane
          left={
            subStep === "bring_it_in" ? (
              <BringItIn />
            ) : (
              <FirstTakeGaps onGoBack={() => reopenBuild.mutate()} />
            )
          }
          right={<AllyPane />}
        />
      </div>
    </div>
  );
}
