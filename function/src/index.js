import functions from "@google-cloud/functions-framework";
import { Storage } from "@google-cloud/storage";
import { extractDocumentMetadata, parseNoteIdFromPath } from "./extract.js";

const storage = new Storage();

functions.cloudEvent("processStudyNote", async (cloudEvent) => {
  const data = cloudEvent.data ?? {};
  const bucketName = data.bucket;
  const objectName = data.name;
  const contentType = data.contentType ?? "";

  console.log(`[processStudyNote] Event received for gs://${bucketName}/${objectName}`);

  const noteId = parseNoteIdFromPath(objectName);
  if (!noteId) {
    console.log(`[processStudyNote] Ignoring non-note object: ${objectName}`);
    return;
  }

  const azureApiUrl = process.env.AZURE_API_URL;
  const webhookSecret = process.env.WEBHOOK_SHARED_SECRET;
  if (!azureApiUrl || !webhookSecret) {
    throw new Error("Missing AZURE_API_URL or WEBHOOK_SHARED_SECRET environment variables");
  }

  let payload;
  try {
    const [fileBuffer] = await storage.bucket(bucketName).file(objectName).download();
    const metadata = await extractDocumentMetadata(fileBuffer, contentType);
    payload = {
      status: "ready",
      pageCount: metadata.pageCount,
      wordCount: metadata.wordCount,
      summary: metadata.summary,
    };
  } catch (err) {
    console.error(`[processStudyNote] Failed to extract metadata for ${noteId}:`, err);
    payload = {
      status: "error",
      pageCount: null,
      wordCount: null,
      summary: "Automatic PDF/text extraction failed.",
    };
  }

  const callbackUrl = `${azureApiUrl.replace(/\/$/, "")}/api/internal/notes/${encodeURIComponent(noteId)}/processed`;
  console.log(`[processStudyNote] Calling Azure Backend webhook: ${callbackUrl}`);

  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": webhookSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure webhook failed (${response.status}): ${text}`);
  }

  console.log(`[processStudyNote] Successfully updated note ${noteId} (${payload.status})`);
});
