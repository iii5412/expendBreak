# T3. 세션 폐기와 만료 처리 PRD

- 문서 상태: Draft v1.0
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

- [ ] `session:revoke owner` 실행 후 60초 안에 기존 토큰의 AI 요청이 401 `session_revoked`를 받는다.
- [ ] 폐기 후 1시간 안에 Firestore 리스너도 권한 오류로 끊기고 앱이 잠금 화면을 표시한다.
- [ ] 만료 토큰으로 영수증 OCR·분석 피드백·채팅을 호출하면 세 경우 모두 잠금 화면이 뜬다.
- [ ] “로그인 유지 안 함” 토큰은 12시간 뒤 401을 받는다.
- [ ] 구형식 토큰도 이번 배포에서는 정상 동작한다.
