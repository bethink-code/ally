import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAuth } from "@/lib/invalidation";
import { Button } from "@/components/ui/button";
import { StatementUpload } from "@/components/StatementUpload";
import { ContentPaneHeader } from "@/components/layout/ContentPaneHeader";
import { useStatementQueue } from "@/hooks/useStatementQueue";
import { StatementList } from "./StatementList";
import type { Statement } from "@shared/schema";

// Bring it in — sub-step A of Your picture.
// Left pane: its own pane header + drop zone + statement list + "show me my picture" action.
// Ally's pane (to the right) carries the coaching copy and chat input.
export function BringItIn() {
  const queueState = useStatementQueue();
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const statements = statementsQ.data ?? [];
  const extractedCount = statements.filter((s) => s.status === "extracted").length;

  const completeBuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/build-complete"),
    onSuccess: () => invalidateAuth(queryClient),
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <ContentPaneHeader step={1} title="Upload your statements" subtitle="12 months of PDFs — any South African bank" />
      <main className="flex-1 overflow-y-auto px-6 py-8 min-h-0 space-y-8">
        <StatementUpload
          queue={queueState.queue}
          anyBusy={queueState.anyBusy}
          rejectWarning={queueState.rejectWarning}
          onStageFiles={queueState.stageFiles}
          onClearFinished={queueState.clearFinished}
        />

        <StatementList statements={statements} />
      </main>

      {extractedCount > 0 && (
        <div className="border-t border-border px-6 py-4 flex justify-end">
          <Button
            onClick={() => completeBuild.mutate()}
            disabled={completeBuild.isPending || queueState.anyBusy}
          >
            {completeBuild.isPending ? "Saving…" : "Show me my picture →"}
          </Button>
        </div>
      )}
    </div>
  );
}
