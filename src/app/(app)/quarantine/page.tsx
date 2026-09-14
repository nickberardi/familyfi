import { redirect } from "next/navigation";

export default function QuarantineRedirect() {
  redirect("/devices");
}
