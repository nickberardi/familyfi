const LINE = "=".repeat(66);

export function recoveryAdminBanner(password: string): string {
  return [
    "",
    LINE,
    "  FamilyFi recovery admin",
    "    username: admin",
    `    password: ${password}`,
    "  This is DEFAULT_PASSWORD in .env. Change it there to pick your own.",
    LINE,
    "",
  ].join("\n");
}

export function unifiMockBanner(): string {
  return [
    "",
    LINE,
    "  UniFi mock enabled (dummy household, no live console)",
    "    Settings API key: mock-unifi-key",
    "    Console: 127.0.0.1  (https://127.0.0.1/proxy/network/integration)",
    "    Extra adult login: pat  (same password as admin)",
    "  Turn UNIFI_MOCK off to talk to a real gateway. Mocks do not prove enforcement.",
    LINE,
    "",
  ].join("\n");
}

export function logRecoveryAdmin(password: string, output: (line: string) => void = console.log): void {
  output(recoveryAdminBanner(password));
}

export function logUnifiMock(output: (line: string) => void = console.log): void {
  output(unifiMockBanner());
}
