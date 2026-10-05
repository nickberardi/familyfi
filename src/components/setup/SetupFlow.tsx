"use client";

import { useState } from "react";
import { AppDataProvider } from "@/components/AppDataProvider";
import { browserSignIn } from "@/components/SignInForm";
import { AdminSignInStep, SetupFrame } from "@/components/setup/SetupFrame";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { RECOVERY_USERNAME } from "@/lib/constants";
import { setupCta } from "@/lib/setup";

/**
 * First-time setup. A new install opens here before anyone has signed in: the first step hands over
 * the admin password, and continuing signs this browser in with it before the rest of setup loads.
 * `password` is null once the household has a gateway; setup then needs a signed-in admin.
 */
export function SetupFlow({ signedIn, password }: { signedIn: boolean; password: string | null }) {
  const [entered, setEntered] = useState(signedIn);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (entered) {
    return (
      <AppDataProvider>
        <SetupWizard initialStep={signedIn ? 0 : 1} password={password} />
      </AppDataProvider>
    );
  }

  async function next() {
    if (!password) return;
    setPending(true);
    setError("");
    const failure = await browserSignIn(RECOVERY_USERNAME, password);
    setPending(false);
    if (failure) return setError(failure);
    setEntered(true);
  }

  return (
    <SetupFrame step={0} error={error} pending={pending} cta={setupCta(0, false)} onNext={() => void next()}>
      <AdminSignInStep password={password} />
    </SetupFrame>
  );
}
