import { redirect } from "next/navigation";

/** The update now lives on Settings' Maintenance tab; old links and bookmarks land there. */
export default function UpdatePage() {
  redirect("/settings?tab=maintenance");
}
