import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAuth } from "@/lib/invalidation";
import { useAuth } from "@/hooks/useAuth";
import { getPictureSubStep, type PictureSubStep } from "@/lib/subStep";
import { formatDateLong, formatTimeAgo } from "@/lib/formatters";
import {
  CANVAS_KEYS,
  CANVAS_PILL_LABEL,
  CANVAS_CARD_TITLE,
  CANVAS_TAB_CAPTION,
  PICTURE_STAGE,
  canvasStates,
  type CanvasKey,
} from "@/lib/canvasCopy";
import type { Statement, Analysis } from "@shared/schema";

// Canvas pill + megamenu (the arc per brief §6). The menu has four sections:
//   1. Canvas tab bar (the four canvases across the top)
//   2. Ally narration paragraph
//   3. The four stage cards within the active canvas
//   4. History footer
// This structure is the template for every canvas menu going forward.
export function CanvasMenu({ activeCanvas }: { activeCanvas: CanvasKey }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-foreground/90 hover:bg-muted/70 transition-colors"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="font-serif text-lg text-accent">{CANVAS_PILL_LABEL[activeCanvas]}</span>
        <span className="text-muted-foreground text-sm">▾</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/65 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Canvas navigation"
            className="fixed inset-x-0 top-28 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="w-full max-w-5xl rounded-xl border border-border bg-card shadow-2xl pointer-events-auto">
              <Arc activeCanvas={activeCanvas} onClose={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Arc({ activeCanvas, onClose }: { activeCanvas: CanvasKey; onClose: () => void }) {
  const { user } = useAuth();
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const analysisQ = useQuery<Analysis | null>({ queryKey: ["/api/analysis/latest"] });

  const reopenBuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/build-reopen"),
    onSuccess: () => {
      invalidateAuth(queryClient);
      onClose();
    },
  });

  const subStep = user ? getPictureSubStep(user) : "bring_it_in";
  const extractedCount = (statementsQ.data ?? []).filter((s) => s.status === "extracted").length;
  const analysisDone = analysisQ.data?.status === "done";

  return (
    <div>
      <CanvasTabs activeCanvas={activeCanvas} />
      <div className="px-8 py-8 space-y-6">
        <Narration
          activeCanvas={activeCanvas}
          subStep={subStep}
          extractedCount={extractedCount}
          userCreatedAt={user?.createdAt}
        />
        {activeCanvas === "picture" && (
          <PictureStages
            subStep={subStep}
            extractedCount={extractedCount}
            analysisDone={analysisDone}
            onReopenBuild={() => reopenBuild.mutate()}
            reopenPending={reopenBuild.isPending}
          />
        )}
      </div>
      <HistoryFooter userCreatedAt={user?.createdAt} onClose={onClose} />
      {reopenBuild.isError && (
        <div className="px-6 pb-3 text-xs text-destructive">
          Couldn't go back — {reopenBuild.error instanceof Error ? reopenBuild.error.message : "try again"}.
        </div>
      )}
    </div>
  );
}

function CanvasTabs({ activeCanvas }: { activeCanvas: CanvasKey }) {
  const states = canvasStates(activeCanvas);
  return (
    <div className="grid grid-cols-4 border-b border-border pt-8">
      {CANVAS_KEYS.map((k) => {
        const state = states[k];
        const isCurrent = state === "current";
        return (
          <div
            key={k}
            className={`px-6 py-5 border-b-2 ${
              isCurrent ? "border-accent" : "border-transparent"
            }`}
          >
            <div
              className={`font-serif text-base leading-tight ${
                isCurrent ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {CANVAS_CARD_TITLE[k]}
            </div>
            <div
              className={`text-[11px] mt-0.5 ${
                isCurrent ? "text-accent" : "text-muted-foreground/70"
              }`}
            >
              {CANVAS_TAB_CAPTION[state]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Narration({
  activeCanvas,
  subStep,
  extractedCount,
  userCreatedAt,
}: {
  activeCanvas: CanvasKey;
  subStep: PictureSubStep;
  extractedCount: number;
  userCreatedAt?: string;
}) {
  const paragraphs = narrationFor({ activeCanvas, subStep, extractedCount, userCreatedAt });
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-foreground/85 leading-relaxed max-w-3xl">
          {p}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">No rush. One thing at a time.</p>
    </div>
  );
}

function narrationFor({
  activeCanvas,
  subStep,
  extractedCount,
  userCreatedAt,
}: {
  activeCanvas: CanvasKey;
  subStep: PictureSubStep;
  extractedCount: number;
  userCreatedAt?: string;
}): string[] {
  if (activeCanvas !== "picture") {
    return [
      activeCanvas === "analysis"
        ? "Our analysis is next — it unlocks once you agree your baseline."
        : activeCanvas === "plan"
          ? "Your plan comes after the analysis. One thing at a time."
          : "Your progress wakes up once you have a plan in motion.",
    ];
  }

  if (subStep === "bring_it_in" && extractedCount === 0) {
    return [
      "We're just getting started. Drop your last twelve months of statements on the left whenever you're ready — the more I see, the clearer your picture gets. Once we're through all four stages, we'll agree a baseline.",
    ];
  }

  if (subStep === "bring_it_in") {
    const word = extractedCount === 1 ? "statement" : "statements";
    return [
      `You've uploaded ${extractedCount} ${word} so far. Keep going when you're ready — twelve months gives me a full year to work with. Once we're through all four stages, we'll agree a baseline.`,
    ];
  }

  // first_take_gaps
  const since = userCreatedAt ? formatTimeAgo(userCreatedAt) : "a little while";
  return [
    `We've been working on your financial snapshot since ${since}. You've uploaded ${extractedCount} ${extractedCount === 1 ? "month" : "months"} of statements, and we're working through the gaps together.`,
    "Once we've talked through everything, we'll agree a baseline and the rest of what we're doing together unlocks.",
  ];
}

const STAGE_ORDER: PictureSubStep[] = ["bring_it_in", "first_take_gaps", "agreed", "live"];

function PictureStages({
  subStep,
  extractedCount,
  analysisDone,
  onReopenBuild,
  reopenPending,
}: {
  subStep: PictureSubStep;
  extractedCount: number;
  analysisDone: boolean;
  onReopenBuild: () => void;
  reopenPending: boolean;
}) {
  const currentIdx = STAGE_ORDER.indexOf(subStep);

  return (
    <div className="space-y-2">
      <SectionLabel>The four stages of your financial snapshot</SectionLabel>
      <div className="grid grid-cols-4 gap-3">
        {STAGE_ORDER.map((stage, i) => {
          const stageIdx = i;
          const relationToCurrent: "past" | "current" | "next" | "future" =
            stageIdx < currentIdx
              ? "past"
              : stageIdx === currentIdx
                ? "current"
                : stageIdx === currentIdx + 1
                  ? "next"
                  : "future";

          const meta = PICTURE_STAGE[stage];
          const badge = stageBadge(stageIdx + 1);
          const status = stageStatus(stage, relationToCurrent, extractedCount, analysisDone);
          const clickable = stage === "bring_it_in" && subStep === "first_take_gaps" && !reopenPending;

          return (
            <StageCard
              key={stage}
              badge={badge}
              title={meta.title}
              description={meta.description}
              status={status}
              relation={relationToCurrent}
              onClick={clickable ? onReopenBuild : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function stageBadge(n: number): string {
  return String(n);
}

function stageStatus(
  stage: PictureSubStep,
  relation: "past" | "current" | "next" | "future",
  extractedCount: number,
  analysisDone: boolean,
): string {
  if (stage === "bring_it_in") {
    if (relation === "current") {
      const toGo = Math.max(0, 12 - extractedCount);
      return toGo > 0 ? `${extractedCount} read · ${toGo} to go` : `${extractedCount} read`;
    }
    return relation === "past" ? `${extractedCount} · done` : "—";
  }
  if (stage === "first_take_gaps") {
    if (relation === "current") return analysisDone ? "In conversation" : "Reading";
    if (relation === "next") return "Opens when you're ready";
    return relation === "past" ? "Done" : "—";
  }
  if (stage === "agreed") {
    if (relation === "current") return "In progress";
    if (relation === "next") return "Coming up";
    return relation === "past" ? "Dated" : "Pending";
  }
  // live
  if (relation === "current") return "Current";
  return "—";
}

function StageCard({
  badge,
  title,
  description,
  status,
  relation,
  onClick,
}: {
  badge: string;
  title: string;
  description: string;
  status: string;
  relation: "past" | "current" | "next" | "future";
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  const base = "flex flex-col gap-2 p-4 rounded-lg border text-left min-h-[170px] transition-colors";
  const cls =
    relation === "current"
      ? "border-accent bg-accent/5"
      : relation === "next"
        ? "border-border bg-background"
        : "border-dashed border-border/60 bg-background opacity-65";

  const content = (
    <>
      <div
        className={`font-serif text-5xl leading-none ${
          relation === "current" ? "text-accent" : "text-muted-foreground/60"
        }`}
      >
        {badge}
      </div>
      <div className="font-serif text-xl leading-tight">{title}</div>
      <p className="text-xs text-foreground/75 leading-relaxed">{description}</p>
      <div className="mt-auto text-xs text-muted-foreground">{status}</div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${cls} hover:bg-muted cursor-pointer`}
      >
        {content}
      </button>
    );
  }
  return <div className={`${base} ${cls}`}>{content}</div>;
}

function HistoryFooter({ userCreatedAt, onClose }: { userCreatedAt?: string; onClose: () => void }) {
  const started = userCreatedAt ? formatDateLong(userCreatedAt) : "—";
  return (
    <div className="border-t border-border px-8 py-4 flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">
        Your history with Ally — 0 baselines to come · 0 plan commitments · Started {started}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Close ✕
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{children}</div>
  );
}
