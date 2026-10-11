import { connection } from "next/server";
import { ApiPage } from "@/components/ApiPage";
import { demoModeEnabled } from "@/server/env";

export default async function ReferencePage() {
  // Read per request, like the demo banner: the image is the same with or without the switch.
  await connection();
  return <ApiPage demo={demoModeEnabled()} />;
}
