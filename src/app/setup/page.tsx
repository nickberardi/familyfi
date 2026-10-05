import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SetupFlow } from "@/components/setup/SetupFlow";
import { setupRedirect } from "@/lib/setup";
import { readSessionFromRequest } from "@/server/auth";
import { demoModeEnabled, recoveryPassword } from "@/server/env";
import { householdHasGateway } from "@/server/setup-entry";

export default async function SetupPage() {
  await connection();
  const demo = demoModeEnabled();
  const configured = demo || (await householdHasGateway());
  // The session cookie is read through `cookies()`; the request itself carries nothing.
  const signedIn = Boolean(await readSessionFromRequest(new Request("http://localhost/setup")));
  const destination = setupRedirect({ demo, configured, signedIn });
  if (destination) redirect(destination);
  // A new install hands over the admin password, which is how its first admin signs in. Once the
  // household has a gateway, the page never carries it.
  return <SetupFlow signedIn={signedIn} password={configured ? null : recoveryPassword()} />;
}
