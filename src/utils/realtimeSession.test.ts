import { describe, expect, it } from 'vitest';
import { createRealtimeSessionForm } from './realtimeSession';

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
});
