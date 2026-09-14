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

export function logRecoveryAdmin(password: string, output: (line: string) => void = console.log): void {
  output(recoveryAdminBanner(password));
}
