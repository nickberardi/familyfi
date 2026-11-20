import { GroupGrid } from "@/components/GroupGrid";
import { demoModeEnabled } from "@/server/env";

export default function FamilyListPage() {
  return <GroupGrid kind="family" demo={demoModeEnabled()} />;
}
