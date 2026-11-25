import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type {
  NotesStore,
  ObjectStorageService,
  StudyNote,
} from "./services/gcp.js";

function createInMemoryDeps() {
  const db = new Map<string, StudyNote>();
  const deletedPaths: string[] = [];

  const notesStore: NotesStore = {
    async listNotes(course?: string) {
      const all = Array.from(db.values());
      return course
        ? all.filter((n) => n.course.toLowerCase().includes(course.toLowerCase()))
        : all;
    },
    async getNote(id) {
      return db.get(id) ?? null;
    },
    async createNote(note) {
      db.set(note.id, note);
    },
    async updateProcessedNote(id, data) {
      const existing = db.get(id);
      if (!existing) return false;
      db.set(id, { ...existing, ...data });
      return true;
    },
    async deleteNote(id) {
      db.delete(id);
    },
  };

  const storageService: ObjectStorageService = {
    async createUploadSignedUrl(gcsPath) {
      return `https://storage.googleapis.com/mock-signed-put/${gcsPath}`;
    },
    async createDownloadSignedUrl(gcsPath) {
      return `https://storage.googleapis.com/mock-signed-get/${gcsPath}`;
    },
    async deleteObject(gcsPath) {
      deletedPaths.push(gcsPath);
    },
  };

  const authMiddleware: RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== "Bearer valid-test-token") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = {
      id: "user-123",
      name: "Halit Test",
      email: "halit@example.com",
      tenantId: "tenant-1",
    };
    next();
  };

  const app = createApp({
    corsOrigins: ["http://localhost:5173"],
    webhookSharedSecret: "super-secret-webhook",
    authMiddleware,
    notesStore,
    storageService,
  });

  return { app, db, deletedPaths };
}

describe("StudyVault Backend API", () => {
  it("returns health status without auth", async () => {
    const { app } = createInMemoryDeps();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects unauthenticated requests to /api/notes", async () => {
    const { app } = createInMemoryDeps();
    const res = await request(app).get("/api/notes");
    expect(res.status).toBe(401);
  });

  it("creates upload URL, processes cross-cloud webhook, lists and deletes note", async () => {
    const { app, deletedPaths } = createInMemoryDeps();

    // 1. Request signed upload URL
    const createRes = await request(app)
      .post("/api/notes/upload-url")
      .set("Authorization", "Bearer valid-test-token")
      .send({
        title: "Cloud Architecture Week 5",
        course: "Cloud Computing",
        fileName: "week5-notes.pdf",
        contentType: "application/pdf",
        fileSize: 20480,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.note.status).toBe("processing");
    expect(createRes.body.uploadUrl).toContain("mock-signed-put");

    const noteId = createRes.body.note.id as string;

    // 2. Reject invalid webhook secret
    const badHook = await request(app)
      .post(`/api/internal/notes/${noteId}/processed`)
      .set("x-webhook-secret", "wrong-secret")
      .send({ status: "ready", pageCount: 5, wordCount: 420, summary: "Test" });
    expect(badHook.status).toBe(401);

    // 3. Accept valid webhook callback from GCP Cloud Run Function
    const goodHook = await request(app)
      .post(`/api/internal/notes/${noteId}/processed`)
      .set("x-webhook-secret", "super-secret-webhook")
      .send({
        status: "ready",
        pageCount: 5,
        wordCount: 420,
        summary: "Multi-cloud patterns and Terraform state management.",
      });
    expect(goodHook.status).toBe(200);

    // 4. List notes and verify processed fields
    const listRes = await request(app)
      .get("/api/notes")
      .set("Authorization", "Bearer valid-test-token");
    expect(listRes.status).toBe(200);
    expect(listRes.body.notes).toHaveLength(1);
    expect(listRes.body.notes[0].status).toBe("ready");
    expect(listRes.body.notes[0].pageCount).toBe(5);

    // 5. Generate download URL
    const dlRes = await request(app)
      .get(`/api/notes/${noteId}/download-url`)
      .set("Authorization", "Bearer valid-test-token");
    expect(dlRes.status).toBe(200);
    expect(dlRes.body.downloadUrl).toContain("mock-signed-get");

    // 6. Delete note
    const delRes = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set("Authorization", "Bearer valid-test-token");
    expect(delRes.status).toBe(204);
    expect(deletedPaths).toHaveLength(1);
  });
});
