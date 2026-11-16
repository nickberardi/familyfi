export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE) return;
  if (process.env.npm_lifecycle_event === "build") return;
  const { boot } = await import("./server/boot");
  await boot();
}
