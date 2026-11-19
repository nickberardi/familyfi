import { connection } from "next/server";
import { PairDevicePage } from "@/components/pair/PairDevicePage";
import { appStoresFor } from "@/lib/pair-device";
import { updateTrack } from "@/server/update-check";

export default async function Page() {
  // Read per request: the image is the same on every track, and FAMILYFI_UPDATE_TAG says which one this is.
  await connection();
  return <PairDevicePage stores={appStoresFor(updateTrack())} />;
}
