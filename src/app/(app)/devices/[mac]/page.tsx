import { DeviceDetailPage } from "@/components/DeviceDetail";

export default function Page({ params }: { params: Promise<{ mac: string }> }) {
  return <DeviceDetailPage params={params} />;
}
