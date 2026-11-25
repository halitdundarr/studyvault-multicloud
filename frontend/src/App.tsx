import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { trackEvent } from "./lib/analytics";
import {
  type StudyNote,
  deleteNote,
  fetchNotes,
  requestDownloadUrl,
  requestUploadUrl,
  uploadFileToSignedUrl,
} from "./lib/api";
import { API_SCOPE, loginRequest } from "./lib/authConfig";

const COURSES = [
  "Cloud Computing",
  "Distributed Systems",
  "Operating Systems",
  "Database Systems",
  "Computer Networks",
  "Software Engineering",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function App() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const activeAccount = accounts[0];

  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [courseFilter, setCourseFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [course, setCourse] = useState(COURSES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStep, setUploadStep] = useState<string | null>(null);

  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!activeAccount) throw new Error("Please sign in first.");
    try {
      const result = await instance.acquireTokenSilent({
        scopes: [API_SCOPE],
        account: activeAccount,
      });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await instance.acquireTokenPopup({
          scopes: [API_SCOPE],
        });
        return result.accessToken;
      }
      throw err;
    }
  }, [activeAccount, instance]);

  const loadNotes = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const list = await fetchNotes(token, courseFilter || undefined);
      setNotes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [courseFilter, getAccessToken, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadNotes();
    } else {
      setNotes([]);
    }
  }, [isAuthenticated, loadNotes]);

  // Auto-poll while any note is still being processed by GCP Cloud Run Function
  useEffect(() => {
    const hasProcessing = notes.some((n) => n.status === "processing");
    if (!isAuthenticated || !hasProcessing) return;

    const timer = window.setInterval(() => {
      void loadNotes();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, loadNotes, notes]);

  const handleSignIn = async () => {
    setError(null);
    try {
      await instance.loginPopup(loginRequest);
      trackEvent("login_entra", { method: "microsoft_entra_id" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  };

  const handleSignOut = async () => {
    await instance.logoutPopup();
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim()) return;

    const contentType =
      file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")
        ? "text/plain"
        : "application/pdf";

    setError(null);
    setUploadStep("1/3 Requesting V4 Signed URL from Azure Backend API...");
    try {
      const token = await getAccessToken();
      const { note, uploadUrl } = await requestUploadUrl(token, {
        title: title.trim(),
        course,
        fileName: file.name,
        contentType,
        fileSize: file.size,
      });

      setUploadStep("2/3 Uploading directly to private GCP Cloud Storage...");
      await uploadFileToSignedUrl(uploadUrl, file);

      trackEvent("upload_note", {
        course,
        file_type: contentType,
        file_size_kb: Math.max(1, Math.round(file.size / 1024)),
      });

      setUploadStep(
        "3/3 Uploaded! GCP Cloud Run Function is extracting metadata & summary..."
      );
      setNotes((prev) => [note, ...prev]);
      setTitle("");
      setFile(null);

      window.setTimeout(() => {
        setUploadStep(null);
        void loadNotes();
      }, 2500);
    } catch (err) {
      setUploadStep(null);
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleDownload = async (note: StudyNote) => {
    setError(null);
    try {
      const token = await getAccessToken();
      const { downloadUrl } = await requestDownloadUrl(token, note.id);
      trackEvent("download_note", { course: note.course, note_id: note.id });
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDelete = async (note: StudyNote) => {
    setError(null);
    try {
      const token = await getAccessToken();
      await deleteNote(token, note.id);
      trackEvent("delete_note", { course: note.course, note_id: note.id });
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="badges">
            <span className="badge azure">Azure SWA &amp; Container Apps</span>
            <span className="badge gcp">GCP Storage, Function &amp; Firestore</span>
            <span className="badge entra">Entra ID + GA4</span>
          </div>
          <h1>StudyVault</h1>
          <p className="subtitle">
            Multi-cloud lecture notes &amp; document hub with automatic PDF summary extraction
          </p>
        </div>

        <div className="auth-box">
          {isAuthenticated && activeAccount ? (
            <>
              <div className="user-info">
                <strong>{activeAccount.name ?? "Signed-in User"}</strong>
                <span>{activeAccount.username}</span>
              </div>
              <button className="btn secondary" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={handleSignIn}>
              Sign in with Microsoft Entra ID
            </button>
          )}
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {!isAuthenticated ? (
        <section className="card hero">
          <h2>Sign in to access shared lecture notes</h2>
          <p>
            Authenticate with <strong>Microsoft Entra ID</strong>. Your JWT token is validated
            by the <strong>Azure Container Apps</strong> API before accessing{" "}
            <strong>GCP Firestore</strong> and private <strong>Google Cloud Storage</strong>.
          </p>
          <button className="btn primary large" onClick={handleSignIn}>
            Continue with Microsoft Entra ID
          </button>
        </section>
      ) : (
        <main className="grid">
          <section className="card upload-card">
            <h2>Upload Lecture Note</h2>
            <p className="muted">
              Upload a PDF or TXT file (max 10 MB). A GCP Cloud Run Function automatically
              extracts page count, word count, and a text summary.
            </p>

            <form onSubmit={handleUpload} className="form">
              <label>
                Note Title
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="e.g. Week 6 — Terraform & OIDC"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label>
                Course
                <select value={course} onChange={(e) => setCourse(e.target.value)}>
                  {COURSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Document (.pdf or .txt)
                <input
                  type="file"
                  required
                  accept=".pdf,.txt,application/pdf,text/plain"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>

              {uploadStep && <div className="alert info">{uploadStep}</div>}

              <button
                type="submit"
                className="btn primary"
                disabled={!file || !title.trim() || Boolean(uploadStep)}
              >
                {uploadStep ? "Uploading..." : "Upload to StudyVault"}
              </button>
            </form>
          </section>

          <section className="notes-section">
            <div className="toolbar">
              <h2>Shared Notes ({notes.length})</h2>
              <div className="toolbar-actions">
                <select
                  aria-label="Filter by course"
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                >
                  <option value="">All courses</option>
                  {COURSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  className="btn secondary"
                  onClick={() => void loadNotes()}
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            {notes.length === 0 ? (
              <div className="card empty">
                <p>No lecture notes uploaded yet. Upload your first PDF or TXT on the left!</p>
              </div>
            ) : (
              <div className="notes-list">
                {notes.map((note) => (
                  <article key={note.id} className="card note-card">
                    <div className="note-top">
                      <span className="course-pill">{note.course}</span>
                      <span className={`status-pill ${note.status}`}>
                        {note.status === "processing"
                          ? "Processing in GCP Function..."
                          : note.status === "ready"
                            ? "Ready"
                            : "Extraction Error"}
                      </span>
                    </div>

                    <h3>{note.title}</h3>
                    <p className="meta">
                      {note.fileName} • {formatBytes(note.fileSize)} • Uploaded by{" "}
                      <strong>{note.ownerName}</strong>
                    </p>

                    {note.status === "ready" && (
                      <div className="summary-box">
                        <div className="stats">
                          <span>Pages: {note.pageCount ?? "-"}</span>
                          <span>Words: {note.wordCount ?? "-"}</span>
                        </div>
                        <p>{note.summary}</p>
                      </div>
                    )}

                    <div className="note-actions">
                      <button
                        className="btn primary small"
                        onClick={() => void handleDownload(note)}
                      >
                        Download (Signed URL)
                      </button>
                      {activeAccount &&
                        (activeAccount.localAccountId === note.ownerId ||
                          activeAccount.username === note.ownerEmail) && (
                          <button
                            className="btn danger small"
                            onClick={() => void handleDelete(note)}
                          >
                            Delete
                          </button>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
