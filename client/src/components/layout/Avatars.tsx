// Circle avatars used in pane headers and the top bar.
// UserAvatar: user's photo, or initials if no photo.
// AllyAvatar: serif lowercase "a" — Ally's mark.

export function UserAvatar({
  photoUrl,
  initials,
  size = "md",
}: {
  photoUrl?: string | null;
  initials: string;
  size?: "sm" | "md" | "lg" | "mirror";
}) {
  const sizeClass =
    size === "sm"
      ? "h-8 w-8 text-sm"
      : size === "lg"
        ? "h-12 w-12 text-lg"
        : size === "mirror"
          ? "h-40 w-40 text-4xl"
          : "h-10 w-10 text-base";
  return (
    <div
      className={`${sizeClass} rounded-full border border-border bg-muted overflow-hidden flex items-center justify-center flex-shrink-0`}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-medium text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

export function AllyAvatar({ size = "md" }: { size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-8 w-8 text-lg" : "h-10 w-10 text-xl";
  return (
    <div
      className={`${sizeClass} rounded-full border border-accent bg-background flex items-center justify-center flex-shrink-0`}
    >
      <span className="font-serif lowercase text-accent leading-none -mt-0.5">a</span>
    </div>
  );
}

export function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  const f = firstName?.trim()?.[0];
  const l = lastName?.trim()?.[0];
  if (f && l) return `${f}${l}`.toUpperCase();
  if (f) return f.toUpperCase();
  const e = email?.trim()?.[0];
  return (e ?? "?").toUpperCase();
}
