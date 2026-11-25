import crypto from "node:crypto";
import cors from "cors";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import type {
  NotesStore,
  ObjectStorageService,
  StudyNote,
} from "./services/gcp.js";

const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "text/plain"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const createUploadSchema = z.object({
  title: z.string().trim().min(2).max(120),
  course: z.string().trim().min(2).max(80),
  fileName: z.string().trim().min(1).max(160),
  contentType: z.enum(["application/pdf", "text/plain"]),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
});

const processedWebhookSchema = z.object({
  status: z.enum(["ready", "error"]),
  pageCount: z.number().int().nonnegative().nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  summary: z.string().max(1000).nullable(),
});

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface AppDependencies {
  corsOrigins: string[];
  webhookSharedSecret: string;
  authMiddleware: RequestHandler;
  notesStore: NotesStore;
  storageService: ObjectStorageService;
}

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: deps.corsOrigins,
      credentials: false,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "studyvault-api",
      cloud: "azure-container-apps",
      database: "gcp-firestore",
      storage: "gcp-cloud-storage",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/me", deps.authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });

  app.get("/api/notes", deps.authMiddleware, async (req, res) => {
    try {
      const course =
        typeof req.query.course === "string" ? req.query.course : undefined;
      const notes = await deps.notesStore.listNotes(course);
      res.json({ notes });
    } catch (err) {
      console.error("[GET /api/notes] Error:", err);
      res.status(500).json({ error: "Failed to list study notes" });
    }
  });

  app.post("/api/notes/upload-url", deps.authMiddleware, async (req, res) => {
    const parsed = createUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid note payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { title, course, fileName, contentType, fileSize } = parsed.data;
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      res.status(400).json({ error: "Only PDF and TXT files are supported" });
      return;
    }

    try {
      const id = crypto.randomUUID();
      const safeName = sanitizeFileName(fileName);
      const gcsPath = `notes/${id}/${safeName}`;

      const note: StudyNote = {
        id,
        title,
        course,
        fileName: safeName,
        contentType,
        fileSize,
        gcsPath,
        ownerId: req.user!.id,
        ownerName: req.user!.name,
        ownerEmail: req.user!.email,
        status: "processing",
        pageCount: null,
        wordCount: null,
        summary: null,
        createdAt: new Date().toISOString(),
        processedAt: null,
      };

      const uploadUrl = await deps.storageService.createUploadSignedUrl(
        gcsPath,
        contentType
      );
      await deps.notesStore.createNote(note);

      res.status(201).json({ note, uploadUrl });
    } catch (err) {
      console.error("[POST /api/notes/upload-url] Error:", err);
      res.status(500).json({ error: "Failed to create upload URL" });
    }
  });

  app.get("/api/notes/:id/download-url", deps.authMiddleware, async (req, res) => {
    try {
      const note = await deps.notesStore.getNote(String(req.params.id));
      if (!note) {
        res.status(404).json({ error: "Note not found" });
        return;
      }

      const downloadUrl = await deps.storageService.createDownloadSignedUrl(
        note.gcsPath,
        note.fileName
      );
      res.json({ downloadUrl, fileName: note.fileName });
    } catch (err) {
      console.error("[GET /api/notes/:id/download-url] Error:", err);
      res.status(500).json({ error: "Failed to generate download URL" });
    }
  });

  app.delete("/api/notes/:id", deps.authMiddleware, async (req, res) => {
    try {
      const note = await deps.notesStore.getNote(String(req.params.id));
      if (!note) {
        res.status(404).json({ error: "Note not found" });
        return;
      }
      if (note.ownerId !== req.user!.id) {
        res.status(403).json({ error: "You can only delete your own notes" });
        return;
      }

      await deps.storageService.deleteObject(note.gcsPath);
      await deps.notesStore.deleteNote(note.id);
      res.status(204).send();
    } catch (err) {
      console.error("[DELETE /api/notes/:id] Error:", err);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // Cross-cloud webhook called by GCP Cloud Run Function after PDF/TXT processing
  app.post("/api/internal/notes/:id/processed", async (req, res) => {
    const incomingSecret = req.header("x-webhook-secret") ?? "";
    if (
      !deps.webhookSharedSecret ||
      !timingSafeEqualString(incomingSecret, deps.webhookSharedSecret)
    ) {
      res.status(401).json({ error: "Unauthorized webhook call" });
      return;
    }

    const parsed = processedWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid webhook payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const noteId = String(req.params.id);
      const updated = await deps.notesStore.updateProcessedNote(noteId, {
        ...parsed.data,
        processedAt: new Date().toISOString(),
      });

      if (!updated) {
        res.status(404).json({ error: "Note not found" });
        return;
      }

      res.json({ ok: true, id: noteId, status: parsed.data.status });
    } catch (err) {
      console.error("[POST /api/internal/notes/:id/processed] Error:", err);
      res.status(500).json({ error: "Failed to update processed note" });
    }
  });

  return app;
}
