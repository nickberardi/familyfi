import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { ConnectionTransport, ConnectionTrustMode, TunnelMode } from "@prisma/client";
import { prisma } from "../db";
import { findCloudflared, quickTunnelUrl, startQuickTunnel, tunnelError } from "./cloudflared";
import { startPhoneGateway } from "./phone-gateway";

export type RemoteAccessStatus = "off" | "starting" | "running" | "error" | "unavailable";

export type RemoteAccessState = {
  mode: TunnelMode;
  status: RemoteAccessStatus;
  url: string | null;
  error: string | null;
  endpointId: string | null;
  cloudflared: string | null;
};

type Runtime = {
  status: RemoteAccessStatus;
  url: string | null;
  error: string | null;
  child: ChildProcess | null;
  gateway: { server: Server; port: number } | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  wanted: boolean;
};

/** One tunnel per process, surviving dev reloads of this module. */
const runtime: Runtime = ((globalThis as { familyfiRemoteAccess?: Runtime }).familyfiRemoteAccess ??= {
  status: "off",
  url: null,
  error: null,
  child: null,
  gateway: null,
  restartTimer: null,
  attempts: 0,
  wanted: false,
});

function appPort(): number {
  return Number(process.env.PORT || 3000);
}

/** Points the one app-owned route at the tunnel's current address, keeping its id so phones follow. */
async function adoptUrl(url: string) {
  await prisma().$transaction(async (db) => {
    const household = await db.household.findUniqueOrThrow({ where: { id: "default" } });
    const current = household.tunnelEndpointId
      ? await db.connectionEndpoint.findUnique({ where: { id: household.tunnelEndpointId } })
      : null;
    if (current) {
      await db.connectionEndpoint.update({ where: { id: current.id }, data: { url, enabled: true } });
      return;
    }
    const last = await db.connectionEndpoint.aggregate({ _max: { priority: true } });
    const created = await db.connectionEndpoint.create({
      data: {
        url,
        transport: ConnectionTransport.cloudflare,
        trustMode: ConnectionTrustMode.system,
        priority: Math.min(999, (last._max.priority ?? -10) + 10),
      },
    });
    await db.household.update({ where: { id: "default" }, data: { tunnelEndpointId: created.id } });
  });
}

async function disableRoute() {
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (household?.tunnelEndpointId) {
    await prisma().connectionEndpoint.updateMany({ where: { id: household.tunnelEndpointId }, data: { enabled: false } });
  }
}

function stopChild() {
  if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
  runtime.restartTimer = null;
  runtime.child?.kill();
  runtime.child = null;
}

async function launch() {
  const binary = findCloudflared();
  if (!binary) {
    runtime.status = "unavailable";
    runtime.error = "cloudflared is not installed on this server.";
    return;
  }
  runtime.gateway ??= await startPhoneGateway(appPort());
  runtime.status = "starting";
  runtime.error = null;
  const child = startQuickTunnel(binary.bin, `http://127.0.0.1:${runtime.gateway.port}`);
  runtime.child = child;
  const read = (data: Buffer) => {
    const text = data.toString();
    const url = quickTunnelUrl(text);
    if (url && url !== runtime.url) {
      runtime.url = url;
      runtime.status = "running";
      runtime.attempts = 0;
      void adoptUrl(url).catch((error) => {
        runtime.status = "error";
        runtime.error = `Tunnel is up, but its route could not be saved: ${error instanceof Error ? error.message : String(error)}`;
      });
    }
    const failure = tunnelError(text);
    if (failure && runtime.status !== "running") runtime.error = failure;
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  child.on("exit", () => {
    if (runtime.child !== child) return;
    runtime.child = null;
    runtime.url = null;
    if (!runtime.wanted) return;
    runtime.status = "error";
    runtime.error ??= "The tunnel stopped. Retrying.";
    const delay = Math.min(60_000, 5_000 * 2 ** runtime.attempts++);
    runtime.restartTimer = setTimeout(() => void launch(), delay);
  });
}

export async function remoteAccessState(): Promise<RemoteAccessState> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  return {
    mode: household.tunnelMode,
    status: household.tunnelMode === TunnelMode.off ? "off" : runtime.status,
    url: runtime.url,
    error: runtime.error,
    endpointId: household.tunnelEndpointId,
    cloudflared: findCloudflared()?.version ?? null,
  };
}

export async function setRemoteAccess(mode: typeof TunnelMode.off | typeof TunnelMode.quick) {
  await prisma().household.update({ where: { id: "default" }, data: { tunnelMode: mode } });
  runtime.wanted = mode !== TunnelMode.off;
  stopChild();
  runtime.url = null;
  runtime.error = null;
  runtime.attempts = 0;
  if (mode === TunnelMode.off) {
    runtime.status = "off";
    await disableRoute();
    return;
  }
  await launch();
}

/** Called once at boot: resumes the tunnel the household left on. */
export async function resumeRemoteAccess() {
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (household?.tunnelMode !== TunnelMode.quick) return;
  runtime.wanted = true;
  if (!runtime.child) await launch();
}
