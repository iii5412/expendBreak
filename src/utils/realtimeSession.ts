export function createRealtimeSessionForm(sdp: string, sessionConfig: string): FormData {
  const formData = new FormData();

  // OpenAI expects scalar multipart fields here. Supplying Blobs with filenames
  // makes them file parts and can cause the API to report that `sdp` is missing.
  formData.set('sdp', sdp);
  formData.set('session', sessionConfig);

  return formData;
}
