# T1. 서버 인증 기본값 제거 및 PIN 대입 방어 PRD

- 문서 상태: 구현 완료 (2026-09-23)
- 작성일: 2026-09-23
- 우선순위: P0
- 예상 규모: 1~2일
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md), [DEPLOYMENT.md](./DEPLOYMENT.md)
- 전제(사용자 확인): 운영 서버는 Cloud Run 등 프록시 뒤에서 동작하며, 현재 운영 PIN은 4자리다.

## 1. 배경

`server.ts`는 환경변수가 없을 때 공개된 기본값으로 조용히 기동한다. 또 PIN 대입 방어가 인스턴스 메모리와 프록시 IP에 의존해 실효성이 낮다.

| ID | 문제 | 근거 |
|---|---|---|
| A-01 | 세션 서명 키가 `APP_SESSION_SECRET` → `APP_PIN_HASH` → `APP_ACCESS_KEY` → `'expendbreak_secret_key_2026'` 순으로 대체된다. 마지막 값은 저장소에 공개돼 있어 모두 비면 임의 uid 토큰을 위조할 수 있다. | `server.ts:22-25` |
| A-02 | PIN 해시를 세션 서명 키로 재사용한다. PIN을 바꾸면 모든 세션이 무효화되는 부작용이 있다. | `server.ts:22-25` |
| A-03 | PIN이 설정되지 않으면 운영에서도 `0000`을 허용한다. | `server.ts:111-121` |
| A-04 | `trust proxy` 미설정으로 프록시 뒤에서 `req.ip`가 프록시 주소가 된다. 모든 사용자가 같은 잠금을 공유하거나 제한이 무력화된다. | `server.ts:406-450` |
| A-05 | 실패 카운터가 인스턴스 메모리 `Map`이다. 재시작·스케일아웃마다 초기화되고 항목을 지우지 않아 계속 커진다. | `server.ts:191-192` |
| A-06 | 5회 이후 지연이 최대 60초다. 4자리 PIN(1만 개)은 IP 하나로 약 7일이면 전수 대입된다. | `server.ts:432-436` |
| A-07 | 전역 JSON 본문 한도가 12MB라 비인증 `/api/auth/verify-key`에도 적용된다. | `server.ts:31` |
| A-08 | 보안 헤더(HSTS, `X-Content-Type-Options`, CSP)가 없고 `X-Powered-By`가 노출된다. | `server.ts` |

## 2. 목표

1. 운영 환경에서 안전하지 않은 기본값으로는 서버가 기동하지 않는다.
2. PIN 전수 대입에 필요한 시간을 현실적으로 불가능한 수준(수년)으로 늘린다.
3. 기존 사용자의 로그인 흐름과 데이터는 그대로 유지한다.

### 비목표

- 사용자 이름/비밀번호 체계 도입, OAuth 로그인
- 세션 폐기(→ [T3](./PRD-T3-session-lifecycle.md))

## 3. 요구사항

### R1. 운영 기동 전 설정 검증 (A-01~A-03)

- `NODE_ENV=production`일 때 `validateProductionConfig()`가 기동 전에 실행된다.
- 다음 중 하나라도 해당하면 오류 메시지를 출력하고 `process.exit(1)`한다.
  - `APP_SESSION_SECRET`이 없거나 32바이트 미만
  - `APP_PIN_HASH`가 없거나 `pbkdf2$`로 시작하지 않음
  - `APP_ACCESS_KEY`만 설정됨(평문 PIN 호환 경로)
- 하드코딩 문자열 `'expendbreak_secret_key_2026'`을 삭제한다. 개발 모드에서는 기동 시 난수 비밀키를 만들고 경고를 출력한다.
- 개발 모드의 `0000` 기본 PIN은 유지하되 기동 로그에 경고를 남긴다.
- 서명 키는 `APP_SESSION_SECRET`만 사용한다. PIN 해시 대체 경로를 제거한다.

**전환 주의**: 현재 운영이 `APP_SESSION_SECRET` 없이 `APP_PIN_HASH`로 서명 중이라면, 새 비밀키 도입 시 기존 세션이 모두 만료된다. 배포 공지 후 재로그인하게 하거나, 한 번의 배포 동안만 이전 키로 검증을 허용(`APP_SESSION_SECRET_PREVIOUS`)한다.

### R2. 프록시 뒤 클라이언트 IP 식별 (A-04)

- `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1))`를 설정한다.
- `.env.example`, `DEPLOYMENT.md`에 값의 의미와 Cloud Run 기본값(1)을 문서화한다.

### R3. 영속 PIN 실패 카운터 (A-05, A-06)

PIN이 계정을 식별하므로 대입 공격은 특정 계정이 아니라 **배포 전체**를 대상으로 한다. 방어도 두 단계로 둔다.

| 단계 | 키 | 한도 | 초과 시 |
|---|---|---|---|
| IP 단위 | 클라이언트 IP | 10분에 5회 실패 | 이후 지수 지연, 최대 15분 |
| 전역 | 배포 전체 | 1시간에 30회 실패 | 15분간 모든 PIN 검증 거부(429) |

- 카운터는 Admin SDK로 Firestore `system/pinGuard`(클라이언트 규칙상 접근 불가)에 저장해 인스턴스 간 공유한다. 문서 쓰기는 트랜잭션으로 한다.
- 전역 잠금은 공격자가 소유자를 잠글 수 있는 트레이드오프가 있다. 15분이라는 짧은 시간과 로그 경보로 완화한다.
- 성공 시 해당 IP 카운터만 초기화한다. 전역 카운터는 시간 창으로만 감소한다.
- 메모리 `Map`은 Firestore 장애 시 대체 경로로만 쓰고, 오래된 항목을 주기적으로 정리한다.

### R4. 최소 6자리 PIN (A-06)

- `hash-pin.mjs`, `hash-account.mjs`, 서버 검증 정규식을 `^\d{6,12}$`로 바꾼다.
- 단계적 전환:
  1. 이번 배포: 4~5자리 PIN 로그인은 허용하되 응답에 `pinUpgradeRequired: true`를 넣고, 앱이 “PIN을 6자리 이상으로 바꿔 주세요” 안내를 표시한다.
  2. 운영자가 새 해시를 secret에 등록한 뒤: 환경변수 `PIN_MIN_LENGTH=6`로 4~5자리를 거부한다.
- PIN 변경은 서버 secret 교체로 이뤄지므로 앱 안에서 PIN을 바꾸는 기능은 범위 밖이다.

**효과**: 전역 한도 시간당 30회 기준 4자리는 약 14일, 6자리는 약 3.8년이 걸린다.

### R5. 요청 본문 한도 분리 (A-07)

- 전역 `express.json({ limit: '100kb' })`.
- `/api/ai/receipt`, `/api/ai/voice`에만 라우트 단위로 `express.json({ limit: '12mb' })`를 적용한다.

### R6. 보안 헤더 (A-08)

- `app.disable('x-powered-by')`.
- 모든 응답에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, 운영에서 `Strict-Transport-Security: max-age=31536000`.
- CSP는 Firebase·Gemini·OpenAI Realtime 연결 대상을 파악한 뒤 `Content-Security-Policy-Report-Only`로 먼저 배포한다.

## 4. 수용 기준

- [x] 운영 모드에서 `APP_SESSION_SECRET` 없이 기동하면 즉시 종료되고, 누락된 변수 이름이 로그에 나온다.
- [x] 저장소 어디에도 `expendbreak_secret_key_2026` 문자열이 없다. (코드·스크립트·`.env.example` 기준. 이 PRD의 인용은 제외)
- [x] 서로 다른 두 `X-Forwarded-For` IP의 실패가 서로의 잠금에 영향을 주지 않는다.
- [x] 인스턴스를 재시작해도 전역 실패 카운터가 유지된다.
- [x] 시간당 31번째 실패부터 15분간 올바른 PIN도 429를 받는다.
- [x] `/api/auth/verify-key`에 200KB 본문을 보내면 413, `/api/ai/receipt`에 5MB 이미지는 정상 처리된다.
- [x] 응답 헤더에 `X-Powered-By`가 없고 `nosniff`가 있다.
- [x] 위 항목 각각에 대한 서버 테스트가 있다([T7](./PRD-T7-server-modularization.md)의 supertest 기반, T7 전이면 `verifyPin`·`validateProductionConfig` 단위 테스트). (supertest 대신 실제 Express를 임의 포트에 띄워 `fetch`로 검증)

## 5. 구현 메모 (2026-09-23)

- 모듈: `src/server/authConfig.ts`(기동 검증·서명 키·PIN 길이), `session.ts`, `accounts.ts`, `pinGuard.ts`, `httpSecurity.ts`, `authRoutes.ts`
- 테스트: 같은 폴더의 `*.test.ts`, 클라이언트 안내는 `src/utils/auth.test.ts`
- CSP는 `Content-Security-Policy-Report-Only`로만 배포했다. 운영 로그로 연결 대상을 확인한 뒤 강제 모드로 전환한다.
- Google 자격 증명이 없는 개발 환경(운영이 아니고 `GOOGLE_APPLICATION_CREDENTIALS`도 없음)에서는 Admin SDK가 처리되지 않은 오류로 프로세스를 종료시키므로, PIN 실패 카운터를 메모리에만 둔다.

## 6. 배포 절차

1. `APP_SESSION_SECRET`(`openssl rand -base64 48`)을 운영 secret에 등록한다.
2. `APP_ACCESS_KEY`가 남아 있으면 제거한다.
3. 배포 후 기존 세션 만료로 재로그인이 필요함을 사용자에게 안내한다.
4. 6자리 이상 PIN 해시를 만들어 교체하고, 이후 `PIN_MIN_LENGTH=6`을 설정한다.
