data "azurerm_client_config" "current" {}

# Read GCP stack outputs directly from Terraform remote state (no secrets in git)
data "terraform_remote_state" "gcp" {
  backend = "gcs"
  config = {
    bucket = "studyvault-tfstate-700696007423"
    prefix = "gcp"
  }
}

# ---------------------------------------------------------------------------
# 1. Resource Group
# ---------------------------------------------------------------------------
resource "azurerm_resource_group" "main" {
  name     = "rg-studyvault-prod"
  location = var.location
}

# ---------------------------------------------------------------------------
# 2. Azure Static Web Apps (Free Tier — React Frontend)
# ---------------------------------------------------------------------------
resource "azurerm_static_web_app" "frontend" {
  name                = "swa-studyvault-web"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"
}

# ---------------------------------------------------------------------------
# 3. Azure Key Vault (RBAC + Managed Identity — Zero Plaintext Secrets)
# ---------------------------------------------------------------------------
resource "azurerm_key_vault" "main" {
  name                       = "kv-studyvault-700696"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
}

# Allow local owner & GitHub Actions OIDC SP to manage secrets in Key Vault
resource "azurerm_role_assignment" "deployer_kv_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = "2a0aca28-6117-43ff-ac79-0a38679c9579"
}

resource "azurerm_role_assignment" "github_oidc_kv_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.github_oidc_sp_object_id
}

resource "azurerm_key_vault_secret" "webhook_secret" {
  name         = "webhook-shared-secret"
  value        = data.terraform_remote_state.gcp.outputs.webhook_secret
  key_vault_id = azurerm_key_vault.main.id
  depends_on = [
    azurerm_role_assignment.deployer_kv_officer,
    azurerm_role_assignment.github_oidc_kv_officer,
  ]
}

resource "azurerm_key_vault_secret" "gcp_sa_json" {
  name         = "gcp-service-account-json"
  value        = data.terraform_remote_state.gcp.outputs.azure_backend_sa_key_json
  key_vault_id = azurerm_key_vault.main.id
  depends_on = [
    azurerm_role_assignment.deployer_kv_officer,
    azurerm_role_assignment.github_oidc_kv_officer,
  ]
}

# ---------------------------------------------------------------------------
# 4. Azure Container Apps (Scale-to-Zero Serverless Node.js Backend API)
# ---------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "main" {
  name                = "law-studyvault-prod"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-studyvault-prod"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}

resource "azurerm_container_app" "api" {
  name                         = "ca-studyvault-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type = "SystemAssigned"
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "studyvault-api"
      image  = var.backend_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "CORS_ORIGIN"
        value = "https://${azurerm_static_web_app.frontend.default_host_name},http://localhost:5173"
      }
      env {
        name  = "ENTRA_TENANT_ID"
        value = var.entra_tenant_id
      }
      env {
        name  = "ENTRA_CLIENT_ID"
        value = var.entra_client_id
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = data.terraform_remote_state.gcp.outputs.project_id
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = data.terraform_remote_state.gcp.outputs.notes_bucket_name
      }
      env {
        name  = "AZURE_KEY_VAULT_URL"
        value = azurerm_key_vault.main.vault_uri
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  depends_on = [
    azurerm_key_vault_secret.webhook_secret,
    azurerm_key_vault_secret.gcp_sa_json,
  ]
}

# Allow the Container App's System-Assigned Managed Identity to read Key Vault secrets
resource "azurerm_role_assignment" "api_kv_reader" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_container_app.api.identity[0].principal_id
}
