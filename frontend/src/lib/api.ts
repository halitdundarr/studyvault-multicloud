import { API_BASE_URL } from "./authConfig";

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

async function authFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function fetchNotes(
  token: string,
  course?: string
): Promise<StudyNote[]> {
  const qs = course ? `?course=${encodeURIComponent(course)}` : "";
  const data = await authFetch(`/api/notes${qs}`, token);
  return data.notes as StudyNote[];
}

export async function requestUploadUrl(
  token: string,
  payload: {
    title: string;
    course: string;
    fileName: string;
    contentType: "application/pdf" | "text/plain";
    fileSize: number;
  }
): Promise<{ note: StudyNote; uploadUrl: string }> {
  return authFetch("/api/notes/upload-url", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadFileToSignedUrl(uploadUrl: string, file: File) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/pdf",
    },
    body: file,
  });

  if (!res.ok) {
    throw new Error(`Direct upload to private Cloud Storage failed (${res.status})`);
  }
}

export async function requestDownloadUrl(
  token: string,
  noteId: string
): Promise<{ downloadUrl: string; fileName: string }> {
  return authFetch(`/api/notes/${encodeURIComponent(noteId)}/download-url`, token);
}

export async function deleteNote(token: string, noteId: string): Promise<void> {
  await authFetch(`/api/notes/${encodeURIComponent(noteId)}`, token, {
    method: "DELETE",
  });
}
