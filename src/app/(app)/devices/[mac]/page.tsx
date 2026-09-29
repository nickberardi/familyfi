import { DeviceDetailPage } from "@/components/DeviceDetail";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ mac: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  return <DeviceDetailPage params={params} searchParams={searchParams} />;
}
