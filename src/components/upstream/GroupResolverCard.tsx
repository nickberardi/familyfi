"use client";

import { request } from "@/lib/api";
import type { GroupResolver } from "@/lib/group-resolver";
import { GroupResolverCard as SharedGroupResolverCard } from "@/ui/GroupResolverCard";

/**
 * A group's own DNS-over-HTTPS endpoint on the web's member view: the shared card
 * (`src/ui/GroupResolverCard.tsx`) over the browser's session.
 */
export function GroupResolverCard(props: {
  groupId: string;
  groupName: string;
  dohOverrideUrl: string | null;
  resolver: GroupResolver | null;
  onChanged: () => void;
}) {
  return <SharedGroupResolverCard {...props} request={request} />;
}
