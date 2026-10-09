import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

/**
 * The Docker socket is root on the host. Only the Watchtower service holds it, so FamilyFi itself,
 * which keeps the UniFi key and serves phones, never can; Watchtower acts only on the app, and the
 * token they share is FamilyFi's, read by Watchtower without the power to change it.
 */
type Service = {
  image?: string;
  profiles?: string[];
  ports?: unknown[];
  volumes?: unknown[];
  labels?: Record<string, string>;
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition?: string }>;
};

const compose = YAML.parse(readFileSync(path.resolve(__dirname, "../../docker/docker-compose.yml"), "utf8")) as {
  services: Record<string, Service>;
  volumes: Record<string, unknown>;
};
const mountsSocket = (service: Service) => (service.volumes ?? []).some((volume) => String(volume).includes("docker.sock"));

describe("the updater in docker-compose.yml", () => {
  it("gives the Docker socket to Watchtower alone, which runs with every install and publishes nothing", () => {
    for (const [name, service] of Object.entries(compose.services)) {
      if (name !== "watchtower") expect(mountsSocket(service), name).toBe(false);
    }
    const watchtower = compose.services.watchtower;
    expect(mountsSocket(watchtower)).toBe(true);
    expect(watchtower.profiles).toBeUndefined();
    expect(watchtower.ports ?? []).toEqual([]);
    expect(watchtower.image).toBe("nickfedor/watchtower:latest");
  });

  it("shares FamilyFi's token through the updater volume, read-only for Watchtower, once it exists", () => {
    const { watchtower, app } = compose.services;
    expect(app.volumes).toContain("familyfi-updater:/var/lib/familyfi/updater");
    expect(watchtower.volumes).toContain("familyfi-updater:/run/familyfi-updater:ro");
    expect(watchtower.environment?.WATCHTOWER_HTTP_API_TOKEN).toBe("/run/familyfi-updater/token");
    // Watchtower takes a path it cannot open as the token itself, so it waits for the file.
    expect(app.healthcheck?.test?.join(" ")).toContain("test -s /var/lib/familyfi/updater/token");
    expect(watchtower.depends_on?.app?.condition).toBe("service_healthy");
    expect(compose.volumes).toHaveProperty("familyfi-updater");
    expect(JSON.stringify(compose)).not.toContain("FAMILYFI_UPDATER_TOKEN");
  });

  it("updates only the app, when FamilyFi asks, after the backup hook", () => {
    const { watchtower, app, db } = compose.services;
    expect(watchtower.environment).toMatchObject({
      WATCHTOWER_LABEL_ENABLE: "true",
      WATCHTOWER_HTTP_API_PERIODIC_POLLS: "false",
      WATCHTOWER_LIFECYCLE_HOOKS: "true",
    });
    expect(app.labels).toMatchObject({
      "com.centurylinklabs.watchtower.enable": "true",
      "com.centurylinklabs.watchtower.lifecycle.pre-update": "/app/scripts/runtime/pre-update-backup.sh",
    });
    expect(watchtower.labels?.["com.centurylinklabs.watchtower.enable"]).toBe("false");
    expect(db.labels?.["com.centurylinklabs.watchtower.enable"]).toBeUndefined();
  });

  it("publishes the remote access port beside the app's own", () => {
    const { app } = compose.services;
    expect(app.environment?.FAMILYFI_REMOTE_ACCESS_PORT).toBe("${FAMILYFI_REMOTE_ACCESS_PORT:-7002}");
    expect(app.ports).toContain("${FAMILYFI_REMOTE_ACCESS_PORT:-7002}:${FAMILYFI_REMOTE_ACCESS_PORT:-7002}");
  });
});
