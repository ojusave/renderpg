import type { VideoHost } from "./video";

export type GoogleDriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId?: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

/** Uploads a video into a Google account and shares it so the page can embed Drive's player. */
export class GoogleDriveHost implements VideoHost {
  private token?: { value: string; expiresAt: number };

  constructor(
    private config: GoogleDriveConfig,
    private fetchImpl: FetchLike = fetch,
  ) {}

  async save(input: { name: string; mime: string; body: ReadableStream<Uint8Array>; bytes: number }) {
    const token = await this.accessToken();
    const metadata = { name: input.name, ...(this.config.folderId ? { parents: [this.config.folderId] } : {}) };
    const start = await this.fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": input.mime,
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(15_000),
    });
    const session = start.headers.get("location");
    if (!start.ok || !session) throw new Error(`Google Drive did not accept the upload (${start.status}).`);
    const put = await this.fetchImpl(session, {
      method: "PUT",
      headers: { "content-type": input.mime },
      body: input.body,
      duplex: "half",
      signal: AbortSignal.timeout(240_000),
    });
    const created = (await put.json().catch(() => ({}))) as { id?: string };
    if (!put.ok || !created.id) throw new Error(`Google Drive upload failed (${put.status}).`);
    const share = await this.fetchImpl(`https://www.googleapis.com/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!share.ok) {
      await this.remove(created.id).catch(() => undefined);
      throw new Error("Google Drive would not let this video play on the page. Share the Drive folder so anyone with the link can view it.");
    }
    return { id: created.id };
  }

  async remove(id: string) {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive delete failed (${res.status}).`);
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed (${res.status}).`);
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }
}
