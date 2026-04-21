import { useQuery } from "@tanstack/react-query";

export type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  photoDataUrl: string | null;
  cell: string | null;
  onboardedAt: string | null;
  buildCompletedAt: string | null;
  isAdmin: boolean;
  termsAcceptedAt: string | null;
  createdAt: string;
};

export function useAuth() {
  const { data, isLoading } = useQuery<AuthUser | null>({ queryKey: ["/api/auth/user"] });
  return { user: data ?? null, isLoading };
}
