import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

/**
 * The Docker socket is root on the host. Only the opt-in Watchtower service holds it, so FamilyFi
 * itself, which keeps the UniFi key and serves phones, never can; Watchtower acts only on the app.
 */
type Service = {
  image?: string;
  profiles?: string[];
  ports?: unknown[];
  volumes?: unknown[];
  labels?: Record<string, string>;
  environment?: Record<string, string>;
};

const compose = YAML.parse(readFileSync(path.resolve(__dirname, "../../docker/docker-compose.yml"), "utf8")) as {
  services: Record<string, Service>;
};
const mountsSocket = (service: Service) => (service.volumes ?? []).some((volume) => String(volume).includes("docker.sock"));

describe("the updater in docker-compose.yml", () => {
  it("gives the Docker socket to Watchtower alone, and only behind its profile", () => {
    for (const [name, service] of Object.entries(compose.services)) {
      if (name !== "watchtower") expect(mountsSocket(service), name).toBe(false);
    }
    const watchtower = compose.services.watchtower;
    expect(mountsSocket(watchtower)).toBe(true);
    expect(watchtower.profiles).toEqual(["updater"]);
    expect(watchtower.ports ?? []).toEqual([]);
    expect(watchtower.image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it("updates only the app, when FamilyFi asks, after the backup hook", () => {
    const { watchtower, app, db } = compose.services;
    expect(watchtower.environment).toMatchObject({
      WATCHTOWER_LABEL_ENABLE: "true",
      WATCHTOWER_HTTP_API_PERIODIC_POLLS: "false",
      WATCHTOWER_LIFECYCLE_HOOKS: "true",
      WATCHTOWER_HTTP_API_TOKEN: "${FAMILYFI_UPDATER_TOKEN:-}",
    });
    expect(app.environment?.FAMILYFI_UPDATER_TOKEN).toBe("${FAMILYFI_UPDATER_TOKEN:-}");
    expect(app.labels).toMatchObject({
      "com.centurylinklabs.watchtower.enable": "true",
      "com.centurylinklabs.watchtower.lifecycle.pre-update": "/app/scripts/runtime/pre-update-backup.sh",
    });
    expect(watchtower.labels?.["com.centurylinklabs.watchtower.enable"]).toBe("false");
    expect(db.labels?.["com.centurylinklabs.watchtower.enable"]).toBeUndefined();
  });
});
