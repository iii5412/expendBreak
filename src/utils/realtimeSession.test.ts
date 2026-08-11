import { describe, expect, it } from 'vitest';
import { createRealtimeSessionForm, parseRealtimeSdpBody } from './realtimeSession';

describe('createRealtimeSessionForm', () => {
  it('sends SDP and session configuration as scalar multipart fields', () => {
    const sdp = 'v=0\r\na=group:BUNDLE 0\r\n';
    const session = JSON.stringify({ type: 'realtime', model: 'gpt-realtime-2.1-mini' });
    const formData = createRealtimeSessionForm(sdp, session);

    expect(formData.get('sdp')).toBe(sdp);
    expect(formData.get('session')).toBe(session);
    expect(formData.get('sdp')).not.toBeInstanceOf(Blob);
    expect(formData.get('session')).not.toBeInstanceOf(Blob);
  });

  it('preserves the browser SDP framing including its trailing CRLF', () => {
    const browserSdp = 'v=0\r\na=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

    expect(parseRealtimeSdpBody(browserSdp)).toBe(browserSdp);
    expect(parseRealtimeSdpBody(browserSdp)?.endsWith('\r\n')).toBe(true);
    expect(parseRealtimeSdpBody('   ')).toBeNull();
  });
});
