locals {
  required_apis = [
    "firestore.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "pubsub.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# 1. Private Object Storage Bucket (Lecture Notes PDFs / TXTs)
# ---------------------------------------------------------------------------
resource "google_storage_bucket" "notes" {
  name                        = "studyvault-notes-${var.project_number}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  cors {
    origin          = var.allowed_cors_origins
    method          = ["GET", "PUT", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Content-Disposition"]
    max_age_seconds = 3600
  }
}

# ---------------------------------------------------------------------------
# 2. Cloud Firestore Database (Native Mode)
# ---------------------------------------------------------------------------
resource "google_firestore_database" "default" {
  project                     = var.project_id
  name                        = "(default)"
  location_id                 = var.region
  type                        = "FIRESTORE_NATIVE"
  delete_protection_state     = "DELETE_PROTECTION_DISABLED"
  deletion_policy             = "DELETE"
  depends_on                  = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# 3. Cross-Cloud Webhook Secret stored in GCP Secret Manager
# ---------------------------------------------------------------------------
resource "random_password" "webhook_secret" {
  length  = 40
  special = false
}

resource "google_secret_manager_secret" "webhook_secret" {
  secret_id = "studyvault-webhook-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "webhook_secret" {
  secret      = google_secret_manager_secret.webhook_secret.id
  secret_data = random_password.webhook_secret.result
}

# ---------------------------------------------------------------------------
# 4. Least-Privilege GCP Service Account used by Azure Container Apps Backend
#    (Key is written directly to Azure Key Vault by infra/azure — never in git)
# ---------------------------------------------------------------------------
resource "google_service_account" "azure_backend" {
  account_id   = "studyvault-azure-backend"
  display_name = "StudyVault Azure Backend Cross-Cloud SA"
}

resource "google_project_iam_member" "azure_backend_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.azure_backend.email}"
}

resource "google_storage_bucket_iam_member" "azure_backend_storage" {
  bucket = google_storage_bucket.notes.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.azure_backend.email}"
}

resource "google_service_account_key" "azure_backend_key" {
  service_account_id = google_service_account.azure_backend.name
}

# ---------------------------------------------------------------------------
# 5. Event-Driven Serverless Function (Cloud Run Functions 2nd Gen + Eventarc)
# ---------------------------------------------------------------------------
resource "google_storage_bucket" "function_source" {
  name                        = "studyvault-fn-src-${var.project_number}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true
}

data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../function"
  output_path = "${path.module}/.terraform/function-source.zip"
  excludes    = ["node_modules", "node_modules/**", "src/*.test.js"]
}

resource "google_storage_bucket_object" "function_archive" {
  name   = "studyvault-function-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_source.name
  source = data.archive_file.function_zip.output_path
}

resource "google_service_account" "function_sa" {
  account_id   = "studyvault-fn-sa"
  display_name = "StudyVault Cloud Run Function SA"
}

resource "google_storage_bucket_iam_member" "function_read_notes" {
  bucket = google_storage_bucket.notes.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.function_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "function_read_secret" {
  secret_id = google_secret_manager_secret.webhook_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.function_sa.email}"
}

resource "google_project_iam_member" "function_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

resource "google_project_iam_member" "function_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

data "google_storage_project_service_account" "gcs_account" {}

resource "google_project_iam_member" "gcs_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs_account.email_address}"
}

resource "google_cloudfunctions2_function" "process_note" {
  name        = "studyvault-process-note"
  location    = var.region
  description = "Extracts PDF/TXT metadata and summary when a lecture note is uploaded to private GCS"

  build_config {
    runtime     = "nodejs22"
    entry_point = "processStudyNote"
    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_archive.name
      }
    }
  }

  service_config {
    min_instance_count             = 0
    max_instance_count             = 2
    available_memory               = "256M"
    timeout_seconds                = 60
    service_account_email          = google_service_account.function_sa.email
    ingress_settings               = "ALLOW_INTERNAL_ONLY"
    all_traffic_on_latest_revision = true

    environment_variables = {
      AZURE_API_URL = var.azure_api_url
    }

    secret_environment_variables {
      key        = "WEBHOOK_SHARED_SECRET"
      project_id = var.project_id
      secret     = google_secret_manager_secret.webhook_secret.secret_id
      version    = "latest"
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.storage.object.v1.finalized"
    service_account_email = google_service_account.function_sa.email
    retry_policy          = "RETRY_POLICY_DO_NOT_RETRY"

    event_filters {
      attribute = "bucket"
      value     = google_storage_bucket.notes.name
    }
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.gcs_pubsub_publisher,
    google_project_iam_member.function_event_receiver,
    google_project_iam_member.function_run_invoker,
    google_secret_manager_secret_iam_member.function_read_secret,
    google_secret_manager_secret_version.webhook_secret,
  ]
}

# ---------------------------------------------------------------------------
# 6. GitHub Actions OIDC (Workload Identity Federation — Zero Static Keys)
# ---------------------------------------------------------------------------
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions-pool"
  display_name              = "GitHub Actions OIDC Pool"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc-provider"
  display_name                       = "GitHub OIDC Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "github_actions" {
  account_id   = "github-actions-deployer"
  display_name = "GitHub Actions Terraform OIDC Deployer"
}

resource "google_project_iam_member" "github_actions_owner" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_service_account_iam_member" "github_wif_binding" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
