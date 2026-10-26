export function authRedirectUri(reqUrl: string) {
  return process.env.AUTH_REDIRECT_URI || new URL("/api/auth/callback", reqUrl).toString();
}
