const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirect = "http://127.0.0.1:8765/callback";

if (!clientId || !clientSecret) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive.file",
  access_type: "offline",
  prompt: "consent",
}).toString();

console.log(`Open this URL and approve access:\n${authUrl}`);
Bun.serve({
  hostname: "127.0.0.1",
  port: 8765,
  async fetch(req) {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return new Response("Missing code.");
    const token = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }),
    });
    const json = (await token.json()) as { refresh_token?: string; error?: string };
    console.log(json.refresh_token ? `GOOGLE_REFRESH_TOKEN=${json.refresh_token}` : `Google did not return a refresh token: ${json.error ?? token.status}`);
    setTimeout(() => process.exit(json.refresh_token ? 0 : 1), 20);
    return new Response(json.refresh_token ? "Refresh token printed in the terminal. You can close this tab." : "No refresh token. See the terminal.");
  },
});
