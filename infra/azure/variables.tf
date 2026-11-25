variable "subscription_id" {
  description = "Azure Subscription ID"
  type        = string
  default     = "2f8a9b61-ff9a-4ddc-b164-ece7222ac2c6"
}

variable "location" {
  description = "Primary Azure region"
  type        = string
  default     = "eastus2"
}

variable "entra_tenant_id" {
  description = "Microsoft Entra ID Tenant ID"
  type        = string
  default     = "ca1038c9-b0b7-4908-98b3-7bff70b96247"
}

variable "entra_client_id" {
  description = "Microsoft Entra ID App Registration Client ID"
  type        = string
  default     = "35a23094-bd45-4faa-8957-d52d17f0a1d6"
}

variable "backend_image" {
  description = "Container image for the StudyVault backend API (GHCR)"
  type        = string
  default     = "ghcr.io/halitdundarr/studyvault-api:latest"
}

variable "github_oidc_sp_object_id" {
  description = "Object ID of the GitHub Actions OIDC Service Principal for Key Vault RBAC"
  type        = string
  default     = "a40d9d1e-b583-48a7-9ce4-0a6097c09a2c"
}
