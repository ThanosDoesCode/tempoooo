export function safeStravaUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    const stravaHost = parsed.hostname === "strava.com" || parsed.hostname.endsWith(".strava.com");
    const appLinkHost = parsed.hostname === "strava.app.link";
    return parsed.protocol === "https:" && (stravaHost || appLinkHost) ? parsed.href : null;
  } catch {
    return null;
  }
}
