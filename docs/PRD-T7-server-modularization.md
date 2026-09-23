# T7. 서버 모듈 분리·테스트·관찰성 PRD

- 문서 상태: Draft v1.0
- 작성일: 2026-09-23
- 우선순위: P2 (T1·T3 서버 테스트의 기반이므로 T1과 병행 가능)
- 예상 규모: 2~3일
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md)

## 1. 배경

- `server.ts` 한 파일(약 1,600줄)에 인증, 레거시 마이그레이션, 계좌 병합, APK 업데이트, AI 라우트 7개, 긴 프롬프트 문자열이 모두 있다.
- 서버 코드에는 `src/server/accountMerge.ts` 외에 테스트가 없다. `app`을 export하지 않고 모듈 로드 시 `listen`까지 실행해 테스트에서 불러올 수 없다.
- 거의 같은 요청 제한 함수가 4개 있다: `consumeRealtimeQuota`, `consumeFinanceChatQuota`, `consumeOcrQuota`, `consumeVoiceQuota`(`server.ts:287`, `631`, `772`, `939`). 각자 메모리 `Map`을 두고 항목을 지우지 않는다.
- AI 응답 파싱에 `any`가 많다(테스트 제외 코드 전체 54곳, 상당수가 서버).
- 로그가 `console.error` 문자열뿐이라 요청·계정·지연 시간으로 추적할 수 없고, 헬스체크 엔드포인트가 없다.

## 2. 목표

1. 라우트별로 파일을 나눠 변경 범위를 줄이고, supertest로 HTTP 수준 테스트를 작성할 수 있게 한다.
2. 요청 제한·입력 검증·로그 방식을 한 가지로 통일한다.
3. 동작 변경 없이 리팩터링한다(응답 형식·상태 코드 유지). 동작 변경은 T1·T3·T6에서 한다.

## 3. 요구사항

### R1. 디렉터리 구조

```
server/
  index.ts            # listen + Vite/static (현재 startServer)
  app.ts              # createApp(): express 앱 구성, export
  config.ts           # 환경변수 로드·검증 (T1 validateProductionConfig)
  auth/
    session.ts        # 토큰 생성·검증
    pin.ts            # PIN 해시 검증, 계정 목록
    middleware.ts     # requireAccount
  routes/
    auth.ts           # /api/auth/*
    migration.ts      # /api/migration/*
    bankAccounts.ts   # /api/bank-accounts/*
    appUpdate.ts      # /api/app-update*
    ai/
      classify.ts, receipt.ts, voice.ts, feedback.ts,
      financeChat.ts, categoryRecommend.ts, realtime.ts
  prompts/            # 프롬프트 문자열
  lib/
    rateLimiter.ts
    logger.ts
```

- 기존 `src/server/accountMerge.ts`는 `server/`로 옮긴다.
- `package.json`의 `dev`·`build` 진입점을 `server/index.ts`로 바꾼다.
- 한 번에 옮기지 말고 라우트 파일 단위로 커밋해 리뷰 가능하게 한다.

### R2. 공통 요청 제한기

- `createRateLimiter({ windowMs, max, name })` → `consume(key): boolean`. 만료 항목은 `consume` 시 정리하고, 최대 키 수(예: 10,000)를 넘으면 가장 오래된 항목부터 제거한다.
- 기존 4개 함수를 대체하며 한도 값은 그대로 유지한다(예: OCR 10분 20회, 채팅 10분 40회).
- 인스턴스 간 공유가 필요한 PIN 제한은 T1 R3의 Firestore 카운터를 쓴다. AI 제한은 비용 보호 목적이라 인스턴스 메모리로 충분하다.

### R3. 입력·출력 검증

- `zod`를 도입해 각 AI 라우트의 요청 본문과 Gemini 응답 JSON을 스키마로 검증한다.
- 검증 실패는 400(요청) 또는 502(모델 응답)로 통일한다.
- 목표: `server/` 아래 `any` 0건.

### R4. 구조화 로그와 헬스체크

- `logger.ts`: 한 줄 JSON(`severity`, `message`, `requestId`, `uid`, `route`, `status`, `latencyMs`). Cloud Logging이 `severity`를 인식한다.
- 요청마다 `requestId`를 만들고 응답 헤더 `X-Request-Id`로 돌려준다. 클라이언트 진단 내보내기에 최근 오류 요청의 ID를 남긴다.
- PIN, 토큰, 계좌번호, 거래 메모는 로그에 남기지 않는다.
- `GET /healthz`: 인증 없이 `{ ok: true, version }`. Firestore 연결은 확인하지 않는다(가벼운 생존 확인용).

### R5. 서버 테스트

- `supertest` + Vitest. `createApp()`에 Firebase Admin과 AI 클라이언트를 주입할 수 있게 해 목(mock)으로 교체한다.
- 최소 범위: 인증(성공, 실패, 형식 오류, 지연), `requireAccount`(없음·위조·만료), 요청 제한, 마이그레이션 결과 유형(T2), AI 라우트의 입력 검증.

## 4. 수용 기준

- [ ] `server.ts`가 삭제되고 `server/` 아래 어떤 파일도 400줄을 넘지 않는다.
- [ ] 리팩터링 전후로 모든 API의 상태 코드와 응답 형식이 같다(R5 테스트로 확인).
- [ ] `consume*Quota` 함수가 저장소에 없고 `createRateLimiter`만 쓰인다.
- [ ] `server/`에 `any`가 없다.
- [ ] 운영 로그에서 `requestId`로 한 요청의 로그를 모두 찾을 수 있다.
- [ ] `npm test`가 서버 테스트를 포함해 CI에서 통과한다.
