import { connection } from "next/server";
import { AppDataProvider } from "@/components/AppDataProvider";
import { AppShell } from "@/components/AppShell";
import { demoModeEnabled } from "@/server/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Read per request, like the demo banner: the image is the same with or without the switch.
  await connection();
  return (
    <AppDataProvider>
      <AppShell demo={demoModeEnabled()}>{children}</AppShell>
    </AppDataProvider>
  );
}
