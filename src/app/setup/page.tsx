import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppDataProvider } from "@/components/AppDataProvider";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { demoModeEnabled } from "@/server/env";

export default async function SetupPage() {
  await connection();
  // The demo's gateway and networks are locked, so there is nothing to set up.
  if (demoModeEnabled()) redirect("/family");
  return (
    <AppDataProvider>
      <SetupWizard />
    </AppDataProvider>
  );
}
