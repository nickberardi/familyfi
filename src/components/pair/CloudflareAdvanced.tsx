"use client";

import { useState } from "react";
import { CLOUDFLARE_GUIDE } from "@/lib/connection-routes";
import type { ConnectionRoute, EdgeAccess } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { RouteForm } from "./RouteForm";
import { FIELD } from "./SheetFrame";

/**
 * A Cloudflare Tunnel the household runs, pointed at FamilyFi's phone-only gateway, and
 * optionally behind Cloudflare Access. With Access on, Cloudflare turns away any request
 * without the service token; FamilyFi hands the token to phones in the pairing QR and their
 * signed manifest. Editing a protected route leaves the token as it is unless both halves
 * are pasted again — pasting a different token replaces it.
 */
export function CloudflareAdvanced({
  route,
  access,
  routes,
  onSaved,
  onCancel,
}: {
  /** The saved route being edited, if any. */
  route?: ConnectionRoute;
  /** Its Access token, when it has one. */
  access?: EdgeAccess;
  routes: readonly ConnectionRoute[];
  onSaved: (route: ConnectionRoute) => Promise<void>;
  onCancel?: () => void;
}) {
  const [protect, setProtect] = useState(Boolean(access));
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const pasted = Boolean(clientId.trim() && clientSecret.trim());
  const partial = Boolean(clientId.trim()) !== Boolean(clientSecret.trim());

  let extraBody: Record<string, unknown> = {};
  if (protect) extraBody = pasted ? { edgeAuth: "serviceToken", serviceToken: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } } : { edgeAuth: "serviceToken" };
  else if (access) extraBody = { edgeAuth: "none" };

  return (
    <div data-testid="cloudflare-advanced" className="flex flex-col gap-3">
      <p className="text-[var(--ff-muted)]">
        A tunnel you run in your own Cloudflare account. Point its public hostname at FamilyFi&rsquo;s phone-only gateway,{" "}
        <span className="font-mono">http://app:7002</span> with <span className="font-mono">FAMILYFI_PHONE_GATEWAY_PORT=7002</span> — never at
        the app itself. <Guide />
      </p>
      <RouteForm
        transport="cloudflare"
        route={route}
        routes={routes}
        onSaved={onSaved}
        onCancel={onCancel}
        extraBody={extraBody}
        canSave={!protect || pasted || (Boolean(access) && !partial)}
        extra={
          <div className="flex flex-col gap-2.5">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={protect} onChange={(event) => setProtect(event.target.checked)} />
              Protect with Cloudflare Access
            </label>
            {protect ? (
              <div className="flex flex-col gap-2.5 rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-3">
                <p className="leading-5 text-[var(--ff-muted)]">
                  Paste the service token from your Access application&rsquo;s Service Auth policy. Phones get it in the pairing QR and
                  send it only to this address.
                  {access ? " Leave both blank to keep the current token; paste a new one to replace it." : ""}
                </p>
                <label className="font-semibold text-[var(--ff-muted)]">
                  Client ID
                  <input
                    className={`${FIELD} font-mono`}
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={access?.clientIdHint ?? "….access"}
                  />
                </label>
                <label className="font-semibold text-[var(--ff-muted)]">
                  Client Secret
                  <input
                    className={`${FIELD} font-mono`}
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                </label>
              </div>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

function Guide() {
  return (
    <a href={CLOUDFLARE_GUIDE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--ff-accent)] underline">
      Set up the tunnel
      <Icon name="arrow-square-out" size={14} />
    </a>
  );
}
