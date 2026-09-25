/**
 * Cloudflare Tunnel you run yourself, optionally behind Cloudflare Access. Not built yet:
 * issue #69 replaces this note with a `RouteForm` plus the Access service-token fields.
 */
export function CloudflareAdvanced() {
  return (
    <div data-testid="cloudflare-advanced" className="rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5 leading-5">
      <div className="font-semibold">Coming soon</div>
      <p className="mt-0.5 text-[var(--ff-muted)]">
        Run your own Cloudflare Tunnel, optionally protected by Cloudflare Access. Until then, use Automatic.
      </p>
    </div>
  );
}
