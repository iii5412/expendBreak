const MAX_SDP_LENGTH = 64 * 1024;

export function parseRealtimeSdpBody(body: unknown): string | null {
  if (typeof body !== 'string' || !body.trim() || body.length > MAX_SDP_LENGTH) return null;

  // SDP is line-oriented and commonly ends with CRLF. Return the exact browser
  // payload so trimming does not turn the final line into an unexpected EOF.
  return body;
}

export function createRealtimeSessionForm(sdp: string, sessionConfig: string): FormData {
  const formData = new FormData();

  // OpenAI expects scalar multipart fields here. Supplying Blobs with filenames
  // makes them file parts and can cause the API to report that `sdp` is missing.
  formData.set('sdp', sdp);
  formData.set('session', sessionConfig);

  return formData;
}
