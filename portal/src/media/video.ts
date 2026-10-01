/** Video pitches live outside the web service so viewers do not stream through it. */
export interface VideoHost {
  save(input: { name: string; mime: string; body: ReadableStream<Uint8Array>; bytes: number }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
}

export const DRIVE_FILE = /^gdrive:([A-Za-z0-9_-]{10,})$/;

/** Preview URL for a stored Drive video, or null when the value is a local file. */
export function drivePreviewUrl(stored: string): string | null {
  const id = DRIVE_FILE.exec(stored)?.[1];
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

/** In-memory Drive stand-in for tests. */
export class MemoryVideoHost implements VideoHost {
  files = new Set<string>();

  async save() {
    const id = crypto.randomUUID().replaceAll("-", "");
    this.files.add(id);
    return { id };
  }

  async remove(id: string) {
    this.files.delete(id);
  }
}

/** Used when Google Drive credentials are not configured. */
export class UnavailableVideoHost implements VideoHost {
  async save(): Promise<{ id: string }> {
    throw new Error("Video pitches are stored in Google Drive, and Drive is not connected yet.");
  }

  async remove() {}
}
