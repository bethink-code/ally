import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { StoryRotator } from "@/components/StoryRotator";
import { StoryArticle, type StoryAnalysisResult } from "@/components/StoryArticle";
import { ContentPaneHeader } from "@/components/layout/ContentPaneHeader";
import { useAuth } from "@/hooks/useAuth";
import type { Analysis } from "@shared/schema";

// First take & gaps — sub-step B of Your picture.
// Left pane: its own pane header (with Go back / Run again actions when the Story is ready),
// then the Story as editorial narrative, or the reading/failed/start states while it isn't.
// Ally's pane (to the right) drives the conversation through the gaps.
export function FirstTakeGaps({ onGoBack }: { onGoBack?: () => void }) {
  const { user } = useAuth();
  const firstName = user?.firstName ?? user?.email?.split("@")[0] ?? "";

  const q = useQuery<Analysis | null>({ queryKey: ["/api/analysis/latest"] });
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/analysis/run"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/analysis/latest"] }),
  });

  const latest = q.data ?? null;
  const hasDoneResult = latest?.status === "done" && !!latest.result;
  const isRunning = latest?.status === "analysing" || run.isPending;
  const hasFailure = latest?.status === "failed";

  return (
    <div className="flex flex-col h-full min-h-0">
      <ContentPaneHeader step={2} title="Your picture" subtitle="Your money, as I see it" />

      {q.isLoading ? null : hasDoneResult ? (
        <div className="flex-1 overflow-y-auto px-6 py-8 min-h-0">
          <StoryArticle
            result={latest!.result as StoryAnalysisResult}
            onRerun={() => run.mutate()}
            rerunning={run.isPending}
            onGoBack={onGoBack}
          />
        </div>
      ) : isRunning ? (
        <div className="flex-1 overflow-y-auto px-6 py-12 min-h-0 flex flex-col items-center justify-start text-center space-y-6">
          <div>
            <h2 className="font-serif text-4xl">
              {firstName ? `Reading your year, ${firstName}…` : "Reading across everything you've shared…"}
            </h2>
            <p className="mt-3 text-muted-foreground">This takes a minute.</p>
          </div>
          <div className="w-full max-w-2xl pt-4">
            <StoryRotator label="While I read · a short story" />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-12 min-h-0 flex flex-col items-center justify-start text-center space-y-6">
          <div>
            <h2 className="font-serif text-4xl">
              {firstName ? `${firstName}, let me look at what you've shared.` : "Let me look at what you've shared."}
            </h2>
            <p className="mt-3 text-muted-foreground max-w-md mx-auto">
              I'll read across all your statements and write back with the patterns I can see — and the things I can't.
            </p>
          </div>
          {hasFailure && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Last attempt failed: {latest!.errorMessage ?? "unknown error"}
            </div>
          )}
          <div className="flex flex-col items-center gap-2">
            <Button onClick={() => run.mutate()}>Look at my picture</Button>
            {onGoBack && (
              <Button variant="ghost" size="sm" onClick={onGoBack}>
                Go back and add more
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
