import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { PaneHeader } from "./PaneHeader";
import { UserAvatar, getInitials } from "./Avatars";

// Convenience wrapper around <PaneHeader> for the left (content) pane.
// Pulls avatar, first name, and initials from the signed-in user.
// Sub-step components use this so each owns its own pane header and right-slot.
export function UserPaneHeader({
  statusLine,
  right,
}: {
  statusLine: ReactNode;
  right?: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const firstName = user.firstName ?? user.email.split("@")[0] ?? "";
  const initials = getInitials(user.firstName, user.lastName, user.email);
  const photoSrc = user.photoDataUrl ?? user.profileImageUrl ?? null;
  return (
    <PaneHeader
      avatar={<UserAvatar photoUrl={photoSrc} initials={initials} />}
      name={firstName}
      statusLine={statusLine}
      right={right}
    />
  );
}
