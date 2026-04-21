import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { UserAvatar, getInitials } from "./Avatars";
import type { AuthUser } from "@/hooks/useAuth";

// The "mirror" — per the Ally brief the photo isn't a profile picture, it's a mirror
// that reminds you who this work is for. Enlarged deliberately, with an explicit label
// underneath so the menu affordance is obvious.
export function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const firstName = user.firstName ?? user.email.split("@")[0] ?? "";
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const initials = getInitials(user.firstName, user.lastName, user.email);
  const photoSrc = user.photoDataUrl ?? user.profileImageUrl ?? null;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await apiRequest("POST", "/auth/logout");
    window.location.href = "/";
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative group focus:outline-none rounded-full ring-offset-2 ring-offset-background transition-all hover:ring-4 hover:ring-accent/25 focus-visible:ring-4 focus-visible:ring-accent/50"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${firstName} — open your details menu`}
      >
        <UserAvatar photoUrl={photoSrc} initials={initials} size="mirror" />
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1 h-9 w-9 rounded-full border border-neutral-300 bg-card flex items-center justify-center text-lg text-accent leading-none group-hover:bg-accent group-hover:text-accent-foreground transition-colors"
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-3 w-72 rounded-lg border border-border bg-card shadow-lg py-2 z-30"
        >
          <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
            <UserAvatar photoUrl={photoSrc} initials={initials} size="md" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{fullName}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </div>
          </div>
          <div className="py-1 border-b border-border">
            <MenuItem label="Update your details" stub />
            <MenuItem label="Notifications" stub />
            <MenuItem label="Privacy & data" stub />
            <MenuItem label="Sharing & advisers" stub />
          </div>
          <div className="py-1 border-b border-border">
            <MenuItem label="Billing" stub />
            <MenuItem label="Referrals" stub />
          </div>
          <div className="py-1 border-b border-border">
            <MenuItem label="Help" stub />
            <MenuItem label="About Ally" stub />
            {user.isAdmin && (
              <MenuItem
                label="Admin"
                onClick={() => {
                  setOpen(false);
                  window.location.href = "/admin";
                }}
              />
            )}
          </div>
          <div className="py-1">
            <MenuItem label="Sign out" onClick={signOut} tone="destructive" />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  stub,
  tone,
}: {
  label: string;
  onClick?: () => void;
  stub?: boolean;
  tone?: "destructive";
}) {
  const toneClass = tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <button
      type="button"
      onClick={stub ? undefined : onClick}
      disabled={stub}
      className={`block w-full text-left px-4 py-2 text-sm ${toneClass} ${
        stub ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"
      }`}
    >
      {label}
      {stub && <span className="ml-2 text-xs text-muted-foreground">(soon)</span>}
    </button>
  );
}
