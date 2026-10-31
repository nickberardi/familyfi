import { GroupDetailPage } from "@/components/GroupDetail";
import { demoModeEnabled } from "@/server/env";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <GroupDetailPage kind="family" params={params} demo={demoModeEnabled()} />;
}
