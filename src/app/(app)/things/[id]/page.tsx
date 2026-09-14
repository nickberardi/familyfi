import { GroupDetailPage } from "@/components/GroupDetail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <GroupDetailPage kind="things" params={params} />;
}
