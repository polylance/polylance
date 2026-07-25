// instrumentation.ts (Next.js) — runs once at server startup
export async function register() {
  const { validateAuditXConfig } = await import("./lib/config/validateEnv");
  validateAuditXConfig();
}
