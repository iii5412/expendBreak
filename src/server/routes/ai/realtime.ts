import express from 'express';
import { createHmac } from 'node:crypto';
import { createRealtimeSessionForm, parseRealtimeSdpBody } from '../../../utils/realtimeSession';
import { logger } from '../../lib/logger';
import { REALTIME_ASSISTANT_INSTRUCTIONS } from '../../prompts/realtime';
import type { RouteDeps } from '../types';

export function createRealtimeRouter(deps: RouteDeps) {
  const router = express.Router();

  // PIN-authenticated WebRTC session bootstrap. The standard OpenAI key stays server-side.
  router.post(
    '/realtime/session',
    express.text({ type: ['application/sdp', 'text/plain'], limit: '64kb' }),
    async (req, res) => {
      try {
        if (!deps.limiters.realtime.consume(res.locals.ownerUid)) {
          return res.status(429).json({ message: '라이브 음성 연결 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
        }

        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return res.status(503).json({
            message: 'GPT 라이브 음성이 비활성화되어 있습니다. OPENAI_API_KEY를 설정해주세요.',
          });
        }

        const sdp = parseRealtimeSdpBody(req.body);
        if (!sdp) {
          return res.status(400).json({ message: '올바른 WebRTC 연결 정보가 필요합니다.' });
        }

        const model = process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1-mini';
        const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || 'marin';
        const sessionConfig = JSON.stringify({
          type: 'realtime',
          model,
          instructions: REALTIME_ASSISTANT_INSTRUCTIONS,
          audio: {
            output: { voice },
          },
        });

        const formData = createRealtimeSessionForm(sdp, sessionConfig);

        const safetyIdentifier = createHmac('sha256', deps.sessionSecret)
          .update(String(res.locals.ownerUid))
          .digest('hex');

        const response = await deps.fetchImpl('https://api.openai.com/v1/realtime/calls', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'OpenAI-Safety-Identifier': safetyIdentifier,
          },
          body: formData,
        });

        const responseBody = await response.text();
        if (!response.ok) {
          logger.error('OpenAI Realtime session error:', response.status, responseBody.slice(0, 500));
          let errorDetails = 'GPT 라이브 음성 연결을 만들지 못했습니다.';
          try {
            const parsed = JSON.parse(responseBody);
            if (parsed.error?.message) {
              errorDetails = `OpenAI 오류: ${parsed.error.message}`;
            } else if (parsed.message) {
              errorDetails = parsed.message;
            }
          } catch {
            if (responseBody.trim()) {
              errorDetails = `OpenAI 연결 오류 (${response.status}): ${responseBody.slice(0, 150)}`;
            }
          }
          return res.status(response.status >= 500 ? 502 : response.status).json({
            message: errorDetails,
          });
        }

        return res.status(201).type('application/sdp').send(responseBody);
      } catch (error) {
        logger.error('OpenAI Realtime session failure:', error instanceof Error ? error.message : error);
        return res.status(502).json({ message: 'GPT 라이브 음성 서버 연결에 실패했습니다.' });
      }
    },
  );

  return router;
}
