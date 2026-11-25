variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "studyvault-cloud-2026"
}

variable "project_number" {
  description = "GCP Project Number"
  type        = string
  default     = "700696007423"
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "europe-west1"
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format for OIDC Workload Identity"
  type        = string
  default     = "halitdundarr/studyvault-multicloud"
}

variable "azure_api_url" {
  description = "Public HTTPS URL of the Azure Container Apps backend API (for cross-cloud webhook callback)"
  type        = string
  default     = "https://placeholder.invalid"
}

variable "allowed_cors_origins" {
  description = "Browser origins permitted to PUT/GET files via GCS Signed URLs"
  type        = list(string)
  default     = ["http://localhost:5173"]
}
