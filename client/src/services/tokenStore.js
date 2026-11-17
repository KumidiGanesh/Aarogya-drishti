let accessToken;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || undefined;
}

export function clearAccessToken() {
  accessToken = undefined;
}
