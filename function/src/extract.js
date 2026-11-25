import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extracts page count, word count, and a clean text preview summary
 * from a PDF or plain text buffer.
 */
export async function extractDocumentMetadata(buffer, contentType = "") {
  const isPdf =
    contentType.toLowerCase().includes("pdf") ||
    buffer.subarray(0, 4).toString("ascii") === "%PDF";

  let rawText = "";
  let pageCount = 1;

  if (isPdf) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    pageCount = pdf.numPages;
    const { text } = await extractText(pdf, { mergePages: true });
    rawText = typeof text === "string" ? text : String(text ?? "");
  } else {
    rawText = buffer.toString("utf8");
    pageCount = Math.max(1, Math.ceil(rawText.split(/\r?\n/).length / 45));
  }

  const normalized = rawText.replace(/\s+/g, " ").trim();
  const words = normalized ? normalized.split(" ").filter(Boolean) : [];
  const wordCount = words.length;

  const summary =
    normalized.length > 280
      ? `${normalized.slice(0, 277).trimEnd()}...`
      : normalized || "No extractable text found in this document.";

  return { pageCount, wordCount, summary };
}

/**
 * Parses `notes/<noteId>/<fileName>` GCS object paths.
 */
export function parseNoteIdFromPath(objectName = "") {
  const parts = objectName.split("/");
  if (parts.length < 3 || parts[0] !== "notes" || !parts[1]) {
    return null;
  }
  return parts[1];
}
