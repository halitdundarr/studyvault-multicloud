import { loadConfig } from "./config/secrets.js";
import { createEntraAuthMiddleware } from "./middleware/auth.js";
import { createGcpServices } from "./services/gcp.js";
import { createApp } from "./app.js";

async function main() {
  const config = await loadConfig();
  const { notesStore, storageService } = createGcpServices(config);
  const authMiddleware = createEntraAuthMiddleware({
    clientId: config.entraClientId,
    tenantId: config.entraTenantId,
  });

  const app = createApp({
    corsOrigins: config.corsOrigins,
    webhookSharedSecret: config.webhookSharedSecret,
    authMiddleware,
    notesStore,
    storageService,
  });

  app.listen(config.port, "0.0.0.0", () => {
    console.log(
      `[studyvault-api] Listening on http://0.0.0.0:${config.port} (GCP project: ${config.gcpProjectId})`
    );
  });
}

main().catch((err) => {
  console.error("[studyvault-api] Fatal startup error:", err);
  process.exit(1);
});
