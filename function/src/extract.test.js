import assert from "node:assert/strict";
import test from "node:test";
import { extractDocumentMetadata, parseNoteIdFromPath } from "./extract.js";

test("parseNoteIdFromPath extracts note ID from valid path", () => {
  assert.equal(
    parseNoteIdFromPath("notes/abc-123/week1-slides.pdf"),
    "abc-123"
  );
  assert.equal(parseNoteIdFromPath("other/abc-123/file.pdf"), null);
  assert.equal(parseNoteIdFromPath("notes/"), null);
});

test("extractDocumentMetadata computes wordCount and summary for plain text", async () => {
  const sample = Buffer.from(
    "Cloud Computing Week 4: Multi-cloud architectures connect Azure and GCP securely using OIDC and secret managers.",
    "utf8"
  );
  const result = await extractDocumentMetadata(sample, "text/plain");
  assert.equal(result.pageCount, 1);
  assert.equal(result.wordCount, 16);
  assert.match(result.summary, /Multi-cloud architectures/);
});
