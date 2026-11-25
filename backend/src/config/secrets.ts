import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  entraTenantId: string;
  entraClientId: string;
  gcpProjectId: string;
  gcsBucketName: string;
  webhookSharedSecret: string;
  gcpServiceAccountKey?: {
    client_email: string;
    private_key: string;
    project_id?: string;
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const port = Number(process.env.PORT ?? 8080);
  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const entraTenantId =
    process.env.ENTRA_TENANT_ID ?? "ca1038c9-b0b7-4908-98b3-7bff70b96247";
  const entraClientId =
    process.env.ENTRA_CLIENT_ID ?? "35a23094-bd45-4faa-8957-d52d17f0a1d6";
  const gcpProjectId = process.env.GCP_PROJECT_ID ?? "studyvault-cloud-2026";
  const gcsBucketName =
    process.env.GCS_BUCKET_NAME ?? "studyvault-notes-700696007423";

  let webhookSharedSecret = process.env.WEBHOOK_SHARED_SECRET ?? "";
  let gcpServiceAccountKey: AppConfig["gcpServiceAccountKey"];

  const keyVaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (keyVaultUrl) {
    console.log(`[config] Loading secrets from Azure Key Vault: ${keyVaultUrl}`);
    const credential = new DefaultAzureCredential();
    const secretClient = new SecretClient(keyVaultUrl, credential);

    const [webhookSecret, gcpSaSecret] = await Promise.all([
      secretClient.getSecret("webhook-shared-secret"),
      secretClient.getSecret("gcp-service-account-json"),
    ]);

    if (webhookSecret.value) {
      webhookSharedSecret = webhookSecret.value;
    }
    if (gcpSaSecret.value) {
      gcpServiceAccountKey = JSON.parse(gcpSaSecret.value);
    }
    console.log("[config] Secrets loaded from Azure Key Vault via Managed Identity.");
  }

  return {
    port,
    corsOrigins,
    entraTenantId,
    entraClientId,
    gcpProjectId,
    gcsBucketName,
    webhookSharedSecret,
    gcpServiceAccountKey,
  };
}
