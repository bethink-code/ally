import { CanvasMenu } from "./CanvasMenu";
import { UserMenu } from "./UserMenu";
import { CANVAS_SENTENCE_VERB, type CanvasKey } from "@/lib/canvasCopy";
import type { AuthUser } from "@/hooks/useAuth";

// The three zones of the top bar:
//   [UserMenu]   [centered greeting + canvas pill]   [Ally brand]
// The middle element is the app-wide navigator/context indicator — always sits
// in the true horizontal centre regardless of left/right widths.
export function TopBar({ user, activeCanvas }: { user: AuthUser; activeCanvas: CanvasKey }) {
  const firstName = user.firstName ?? user.email.split("@")[0];
  const verb = CANVAS_SENTENCE_VERB[activeCanvas];

  return (
    <header className="border-b border-border bg-background px-6 py-6 grid grid-cols-[1fr_auto_1fr] items-center gap-6 flex-shrink-0">
      <div className="justify-self-start">
        <UserMenu user={user} />
      </div>
      <div className="flex items-center gap-2 justify-self-center">
        <span className="font-serif text-lg text-accent">
          Hi {firstName}. We're {verb}
        </span>
        <CanvasMenu activeCanvas={activeCanvas} />
      </div>
      <div className="flex flex-col items-end leading-none justify-self-end">
        <span className="font-serif text-3xl">Ally</span>
        <span className="text-xs text-muted-foreground mt-1">your money, understood</span>
      </div>
    </header>
  );
}
