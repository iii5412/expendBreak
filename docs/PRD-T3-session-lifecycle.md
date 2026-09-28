# T3. 세션 폐기와 만료 처리 PRD

- 문서 상태: 구현 완료 v1.1 (2026-09-28)
- 작성일: 2026-09-23
- 우선순위: P1
- 예상 규모: 1일
- 선행 작업: [T1](./PRD-T1-auth-hardening.md) (서명 키 분리)
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md)

## 1. 배경

- API 세션 토큰은 `uid:만료시각:HMAC` 형태의 30일 무상태 토큰이다(`server.ts:165-189`). 서버에서 개별 폐기할 수 없다.
- `e145ddd`(“remember login”)로 토큰이 `localStorage`에 장기 보관될 수 있게 됐다(`auth.ts:118-127`). 기기 분실 시 30일간 AI API를 쓸 수 있다.
- `logoutOwner()`(`auth.ts:150-154`)는 로컬 저장값만 지운다.
- 토큰이 만료돼도 Firebase Auth 세션은 살아 있어 장부는 보이는데 AI 기능만 403으로 실패한다. 401을 처리하는 곳은 `AppLockModal`, `VoiceInputPanel` 두 곳뿐이다.

## 2. 목표

1. 운영자가 특정 계정의 모든 세션을 즉시 폐기할 수 있다.
2. 세션이 만료·폐기되면 앱이 일관되게 PIN 재입력으로 안내한다.
3. 로그인 유지 기간을 선택과 무관하게 명확하게 제한한다.

## 3. 요구사항

### R1. 계정별 세션 세대(`sessionEpoch`)

- 토큰 형식을 `v2:uid:epoch:만료시각:HMAC`로 바꾼다. 구형식(`uid:만료:HMAC`)은 이번 배포 동안만 허용하고 다음 배포에서 제거한다.
- 계정별 현재 epoch는 Firestore `sessionEpochs/{uid}` 문서(클라이언트 규칙상 접근 불가)의 `epoch` 필드(기본 0)에 둔다. 서버는 60초 메모리 캐시로 읽는다.
- `requireAccount`는 토큰 epoch가 현재 epoch보다 작으면 401 `{ error: 'session_revoked' }`를 반환한다.
- 폐기 수단:
  - 스크립트 `npm run session:revoke -- <uid>`: epoch를 1 올린다.
  - 앱 설정의 “다른 기기에서 모두 로그아웃”: `POST /api/auth/revoke-others` → epoch 증가 후 현재 기기에 새 토큰 발급.
- epoch 증가 시 Firebase 쪽도 `adminAuth.revokeRefreshTokens(uid)`를 호출한다. 이미 발급된 Firebase ID 토큰은 최대 1시간 유효하므로, Firestore 접근은 그 안에 끊긴다.

### R2. 만료 응답 통일

- 서버: 토큰 없음·서명 오류·만료·폐기는 모두 **401**, 계정 목록에 없는 uid만 403으로 구분한다. 응답 본문에 `error` 코드(`session_missing`, `session_expired`, `session_revoked`)를 넣는다.
- 클라이언트: `authenticatedFetch`가 401을 받으면 `onSessionExpired` 이벤트를 발생시키고, `App`은 잠금 화면(`AppLockModal`)을 띄운다. 개별 컴포넌트의 401 분기는 제거한다.
- 재로그인 성공 시 사용자가 하던 요청은 자동 재시도하지 않는다(중복 AI 호출 방지). 화면에 “다시 시도” 버튼을 남긴다.

### R3. 로그인 유지 기간

| 선택 | 토큰 수명 | 저장소 |
|---|---|---|
| 로그인 유지 안 함 | 12시간 | `sessionStorage` |
| 로그인 유지 | 30일 | `localStorage` |

- 서버가 `verify-key` 요청의 `remember` 값에 따라 만료를 정한다. 현재는 선택과 무관하게 30일이다.
- 기존 유휴 잠금(`lockPolicy.ts`, 기본 30분)은 그대로 유지한다.

## 4. 수용 기준

- [x] `session:revoke owner` 실행 후 60초 안에 기존 토큰의 AI 요청이 401 `session_revoked`를 받는다. (`requireAccount.test.ts`에서 다른 인스턴스의 epoch 증가 + 60초 캐시 만료로 검증. 스크립트 자체는 운영 자격 증명으로 실행해 보지 않았다)
- [ ] 폐기 후 1시간 안에 Firestore 리스너도 권한 오류로 끊기고 앱이 잠금 화면을 표시한다. (구현: Firebase SDK가 폐기된 refresh token 때문에 스스로 로그아웃하면 `watchFirebaseSession`이 세션 만료로 처리한다. 단위 테스트로만 확인했고 운영에서 1시간 경과를 확인하지 않았다)
- [x] 만료 토큰으로 영수증 OCR·분석 피드백·채팅을 호출하면 세 경우 모두 잠금 화면이 뜬다. (`authenticatedFetch` 한 곳에서 401을 처리한다. 세 요청 동시 401 → 이벤트 1회를 단위 테스트로, 위조 토큰 → 잠금 화면 안내를 로컬 브라우저로 확인)
- [x] “로그인 유지 안 함” 토큰은 12시간 뒤 401을 받는다.
- [x] 구형식 토큰도 이번 배포에서는 정상 동작한다. (epoch 0으로 취급하므로 폐기하면 함께 끊긴다)

## 5. 구현 메모

- 서버: `src/server/session.ts`(v2 토큰, 만료/서명 구분), `sessionEpochs.ts`(Firestore 저장소 + 60초 캐시, 저장소 장애 시 캐시값 사용, 캐시도 없으면 503), `requireAccount.ts`, `authRoutes.ts`(`remember`, `POST /api/auth/revoke-others`), `scripts/revoke-session.mjs`.
- 서명 불일치는 PRD의 세 코드 외에 `session_invalid`로 따로 표시한다. 클라이언트는 401이면 코드와 관계없이 같은 처리를 한다.
- 토큰 발급 시에는 캐시를 거치지 않고 epoch를 새로 읽는다. 다른 인스턴스의 캐시가 오래돼도 새 토큰(더 큰 epoch)은 거부되지 않는다.
- 클라이언트: `authenticatedFetch`의 401과 앱이 요청하지 않은 Firebase 로그아웃이 `onSessionExpired`를 한 번 발생시킨다. `App`은 잠금 버튼과 같은 절차로 잠그고 잠금 화면에 만료 안내를 띄운다. `VoiceInputPanel`의 개별 401 분기는 제거했다.
- **PRD와 다른 점**: 잠금 화면은 앱 화면을 내리므로 하던 화면의 “다시 시도” 버튼은 남지 않는다. 자동 재시도는 하지 않으며, 잠금 화면 안내에 “하던 작업을 다시 시도해 주세요”라고 적었다. 작업 상태 보존이 필요하면 잠금 화면을 오버레이로 바꾸는 별도 작업이 필요하다.
- 개발 환경(Google 자격 증명 없음)에서는 epoch를 메모리에 두고 Firebase refresh token 폐기를 건너뛴다.
- 후속: 다음 배포에서 구형식 토큰 분기를 제거한다.
