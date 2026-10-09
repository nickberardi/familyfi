/**
 * Reading and changing how FamilyFi installs releases, as every client does. Installing creates no
 * UniFi policy, so these go straight to the API rather than through the household store, and a
 * failure rejects with the server's message.
 */
import type { ApiRequest } from "./api-client";
import type { UpdateRun, UpdateSettings } from "./types";

export function loadUpdateSettings(request: ApiRequest) {
  return request<UpdateSettings>("/api/v1/settings/update");
}

/** Asks the Watchtower updater to install the newer release now; FamilyFi restarts on it. */
export function installUpdate(request: ApiRequest) {
  return request<{ run: UpdateRun }>("/api/v1/settings/update/install", { method: "POST" }).then((result) => result.run);
}

export function saveUpdateSchedule(request: ApiRequest, schedule: UpdateSettings["schedule"]) {
  return request<UpdateSettings>("/api/v1/settings/update/schedule", { method: "PUT", body: schedule });
}
