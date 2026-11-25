import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import type { AppConfig } from "../config/secrets.js";

export interface StudyNote {
  id: string;
  title: string;
  course: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  gcsPath: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  status: "processing" | "ready" | "error";
  pageCount: number | null;
  wordCount: number | null;
  summary: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface NotesStore {
  listNotes(course?: string): Promise<StudyNote[]>;
  getNote(id: string): Promise<StudyNote | null>;
  createNote(note: StudyNote): Promise<void>;
  updateProcessedNote(
    id: string,
    data: {
      status: "ready" | "error";
      pageCount: number | null;
      wordCount: number | null;
      summary: string | null;
      processedAt: string;
    }
  ): Promise<boolean>;
  deleteNote(id: string): Promise<void>;
}

export interface ObjectStorageService {
  createUploadSignedUrl(
    gcsPath: string,
    contentType: string
  ): Promise<string>;
  createDownloadSignedUrl(gcsPath: string, fileName: string): Promise<string>;
  deleteObject(gcsPath: string): Promise<void>;
}

export function createGcpServices(config: AppConfig): {
  notesStore: NotesStore;
  storageService: ObjectStorageService;
} {
  const credentials = config.gcpServiceAccountKey
    ? {
        client_email: config.gcpServiceAccountKey.client_email,
        private_key: config.gcpServiceAccountKey.private_key,
      }
    : undefined;

  const firestore = new Firestore({
    projectId: config.gcpProjectId,
    ...(credentials ? { credentials } : {}),
  });

  const storage = new Storage({
    projectId: config.gcpProjectId,
    ...(credentials ? { credentials } : {}),
  });

  const collection = firestore.collection("notes");
  const bucket = storage.bucket(config.gcsBucketName);

  const notesStore: NotesStore = {
    async listNotes(course?: string): Promise<StudyNote[]> {
      let query = collection.orderBy("createdAt", "desc").limit(100);
      const snapshot = await query.get();
      const notes = snapshot.docs.map((doc) => doc.data() as StudyNote);
      if (course) {
        const lower = course.toLowerCase();
        return notes.filter((n) => n.course.toLowerCase().includes(lower));
      }
      return notes;
    },

    async getNote(id: string): Promise<StudyNote | null> {
      const doc = await collection.doc(id).get();
      return doc.exists ? (doc.data() as StudyNote) : null;
    },

    async createNote(note: StudyNote): Promise<void> {
      await collection.doc(note.id).set(note);
    },

    async updateProcessedNote(id, data): Promise<boolean> {
      const ref = collection.doc(id);
      const snap = await ref.get();
      if (!snap.exists) return false;
      await ref.update(data);
      return true;
    },

    async deleteNote(id: string): Promise<void> {
      await collection.doc(id).delete();
    },
  };

  const storageService: ObjectStorageService = {
    async createUploadSignedUrl(
      gcsPath: string,
      contentType: string
    ): Promise<string> {
      const [url] = await bucket.file(gcsPath).getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 10 * 60 * 1000,
        contentType,
      });
      return url;
    },

    async createDownloadSignedUrl(
      gcsPath: string,
      fileName: string
    ): Promise<string> {
      const [url] = await bucket.file(gcsPath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
        responseDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
      });
      return url;
    },

    async deleteObject(gcsPath: string): Promise<void> {
      await bucket.file(gcsPath).delete({ ignoreNotFound: true });
    },
  };

  return { notesStore, storageService };
}
