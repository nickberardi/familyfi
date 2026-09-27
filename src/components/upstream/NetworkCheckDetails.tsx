import { verdictStyle, type UpstreamCheckRow, type UpstreamVerdictValue } from "@/lib/upstream";

function VerdictLabel({ verdict }: { verdict: UpstreamVerdictValue }) {
  const style = verdictStyle({ verdict });
  return <span className="rounded-md border px-1.5 py-0.5 font-sans text-[11px] font-semibold"
    style={{ color: style.ink, background: style.fill, borderColor: style.line }}>{style.label}</span>;
}

/** The measured DNS answer for each managed network and assigned server. */
export function NetworkCheckDetails({ check }: { check: UpstreamCheckRow | null }) {
  if (!check?.networks?.length) return null;
  return (
    <details className="mt-3 rounded-lg border border-[var(--ff-hairline-card)] px-3 py-2 text-[12.5px]">
      <summary className="cursor-pointer font-semibold">Results by network</summary>
      <div className="mt-2 flex flex-col gap-2">
        {check.networks.map((network) => (
          <div key={network.id} className="border-t border-[var(--ff-hairline)] pt-2">
            <div className="flex flex-wrap items-center gap-2 font-semibold">{network.name}<VerdictLabel verdict={network.verdict} /></div>
            {network.error ? <div className="text-[var(--ff-ink-3)]">{network.error}</div> : null}
            {network.servers.map((server) => (
              <div key={server.address} className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ff-ink-3)]">
                <span className="font-mono">{server.address}</span><VerdictLabel verdict={server.verdict} />
                {server.error ? <span>{server.error}</span> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
