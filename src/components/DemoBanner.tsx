import { connection } from "next/server";
import { DEMO_NOTICE } from "@/lib/demo";
import { demoModeEnabled } from "@/server/env";

/** A strip above every page in demo mode. Read per request: the image is the same with or without the switch. */
export async function DemoBanner() {
  await connection();
  if (!demoModeEnabled()) return null;
  return (
    <p role="note" className="m-0 bg-[var(--ff-note-fill)] px-4 py-2 text-center text-[14px] leading-5 text-[var(--ff-ink)]">
      {DEMO_NOTICE}
    </p>
  );
}
