# ExpendBreak 안전 배포 절차

이 변경은 기존 루트 Firestore 데이터를 삭제하지 않고 `users/{OWNER_UID}` 아래에 같은 문서 ID로 복사한다. 첫 운영 배포는 아래 순서를 지켜야 한다.

## 1. 배포 전

1. Firestore 관리 백업을 생성한다.
2. 현재 운영 앱과 Firestore rules 버전을 별도로 보관한다.
3. 운영 서비스 계정이 Firebase custom token 생성과 해당 Firestore database의 Admin 읽기·쓰기를 수행할 수 있는지 확인한다.
4. PIN hash를 로컬에서 생성한다.
5. Firebase Storage가 활성화되어 있고 운영 버킷이 `firebase-applet-config.json`의 `storageBucket`과 일치하는지 확인한다.

```powershell
npm run pin:hash -- 123456
```

출력 전체를 운영 secret `APP_PIN_HASH`에 저장한다. 실제 PIN과 hash는 Git에 커밋하지 않는다. 해시 스크립트는 6~12자리 PIN만 받는다.

배우자처럼 데이터를 완전히 분리할 추가 계정은 별도 PIN으로 생성한다.

```powershell
npm run account:hash -- wife "와이프" 654321
```

출력된 JSON 전체를 운영 secret `APP_ACCOUNTS_JSON`에 저장한다. 여러 계정이면 같은 배열 안에 항목을 추가한다. UID와 PIN은 계정마다 달라야 한다. 기존 계정은 계속 `users/{OWNER_UID}`를 사용하고, 위 예시 계정은 `users/wife`를 사용한다.

필수 환경변수:

- `APP_PIN_HASH`: 위 명령으로 생성한 값. `pbkdf2$`로 시작해야 한다
- `APP_SESSION_SECRET`: 세션 서명 키. 32바이트 이상 임의 값(`openssl rand -base64 48`)
- `OWNER_UID`: 기존 데이터 소유자 UID. 기본값은 `owner`
- `OWNER_NAME`: 기존 계정에 표시할 이름. 기본값은 `내 계정`
- `APP_ACCOUNTS_JSON`: 추가 계정의 `uid`, 표시 이름, PIN hash 배열
- `APP_SESSION_SECRET_PREVIOUS`: 선택. 서명 키 교체 시 한 번의 배포 동안만 이전 키로 발급된 세션을 인정한다
- `TRUST_PROXY_HOPS`: 선택. 클라이언트와 서버 사이 프록시 수. Cloud Run 기본값은 `1`이며, PIN 실패 제한이 실제 클라이언트 IP 기준으로 동작하게 한다
- `PIN_MIN_LENGTH`: 선택. 기본값 `4`. 모든 계정의 PIN을 6자리 이상으로 교체한 뒤 `6`으로 올린다
- `GEMINI_API_KEY`: AI 기능을 사용할 경우
- `GEMINI_CLASSIFY_MODEL`: AI 문장 분류 모델. 기본값 `gemini-3.5-flash-lite`
- `OPENAI_API_KEY`: GPT 라이브 음성을 사용할 경우. 브라우저 환경변수로 노출하지 않고 서버 secret으로만 등록
- `OPENAI_REALTIME_MODEL`: 기본값 `gpt-realtime-2.1-mini`
- `OPENAI_REALTIME_VOICE`: 기본값 `marin`
- `NODE_ENV=production`
- `PORT`: 호스팅 플랫폼이 주입
- `APP_URL`: 운영 앱의 HTTPS origin
- `NATIVE_ALLOWED_ORIGINS=https://localhost`: Android WebView의 정확한 허용 origin

Android APK 빌드 환경에는 같은 운영 origin을 `VITE_API_BASE_URL`로 설정한다. 상세 절차는 [ANDROID.md](./ANDROID.md)를 따른다.

`NODE_ENV=production`에서 `APP_SESSION_SECRET`이 없거나 32바이트 미만이거나, `APP_PIN_HASH`가 없거나 `pbkdf2$` 형식이 아니면 서버는 누락된 변수 이름을 로그에 남기고 기동하지 않는다. 평문 `APP_ACCESS_KEY`만 설정된 경우도 거부한다. `APP_ACCESS_KEY`가 남아 있으면 제거한다.

**세션 서명 키 전환**: 이전 서버는 `APP_SESSION_SECRET`이 없으면 `APP_PIN_HASH`로 세션을 서명했다. 새 키를 넣으면 기존 세션이 모두 만료되므로 배포 후 재로그인을 안내한다. 재로그인을 피하려면 한 번의 배포 동안 `APP_SESSION_SECRET_PREVIOUS`에 이전 서명 값(기존 `APP_PIN_HASH`)을 넣고 다음 배포에서 제거한다.

**PIN 대입 방어**: 실패 카운터는 Firestore `system/pinGuard`에 저장된다(IP는 해시로만 저장). IP마다 10분에 5회 실패하면 지수 지연(최대 15분)이 걸리고, 배포 전체에서 1시간에 30회 실패하면 15분간 모든 PIN 검증을 429로 거부한다. 전역 잠금이 걸리면 서버 로그에 `[ALERT] PIN brute-force lock engaged`가 남는다. 4~5자리 PIN으로 로그인하면 앱이 6자리 이상으로 교체하라고 안내한다.

## 2. 1차 배포 — 앱과 서버

1. `storage.rules`를 운영 Storage에 배포한다. 영수증 원본은 이 규칙 없이는 저장되지 않아야 한다.
2. 새 앱과 서버를 배포하되 Firestore rules는 아직 기존 상태로 둔다.
3. 웹과 Android 앱에서 PIN으로 최초 로그인한다. `/api/auth/verify-key`가 API 세션 토큰과 Firebase custom token을 모두 반환해야 한다.
4. 서버가 `/api/migration/ensure`를 실행하여 루트 컬렉션을 소유자 경로로 복사한다. 소유자 경로에 이미 있는 문서 ID는 덮어쓰지 않고 건너뛴다.
5. `users/{OWNER_UID}/migrations/legacy-root-v1` 보고서가 생성됐는지 확인한다.
6. 각 컬렉션의 `sourceCount`, `copied`, `skippedExisting`, `destinationCount`와 거래 `sourceAmountTotal`, `destinationAmountTotal`(새로 복사한 문서 기준)을 확인한다.
7. `classificationIssues`의 거래·정기 항목 불일치 건수와 금액을 기록한다.
8. 대시보드 월별 수입·지출, 계좌, 정기 항목을 기존 앱과 대조한다.
9. 추가 계정 PIN으로 로그인해 빈 독립 가계부가 생성되고, 기존 소유자 데이터가 보이지 않는지 확인한다.

마이그레이션은 원본을 삭제하지 않고, 다시 실행돼도 소유자 경로의 기존 문서를 덮어쓰지 않는다.

검증(누락 문서, 새로 복사한 거래의 금액 합계)에 실패하면 `/api/migration/ensure`가 500과 `failure` 상세를 반환하고, `users/{OWNER_UID}/migrations/legacy-root-v1-failed`에 원인·시각·컬렉션별 수치를 기록한다. 완료 마커 `legacy-root-v1`은 기록하지 않는다. 앱은 대시보드 대신 “기존 데이터 이전 검증에 실패했습니다” 안내와 `다시 시도` 버튼만 보여 주며, 이 상태에서는 기본 데이터를 만들거나 Firestore에 쓰지 않는다. Admin 자격 증명이 없어 마이그레이션을 실행할 수 없는 개발 환경에서는 `skipped: true`(`reason: admin_db_unavailable`)로 정상 진행한다.

## 3. 2차 배포 — Firestore rules

1. 1차 검증이 끝난 뒤 저장소의 `firestore.rules`를 배포한다.
2. PIN이 없을 때 Firestore 요청이 거부되는지 확인한다.
3. 올바른 PIN 로그인 후 조회·추가·수정·삭제가 가능한지 확인한다.
4. 각 계정에서 다른 계정의 `users/{uid}` 경로 읽기·쓰기가 거부되는지 확인한다.
5. 유형과 맞지 않는 카테고리로 거래 또는 정기 항목 저장이 거부되는지 확인한다.
6. 설정의 `분류 무결성 점검`에서 기존 불일치 건수를 확인한다.

### 3-1. 주기 금액 revision 규칙 (2026-09-21 이후)

`recurringOccurrences`, `transactions`, `amountChanges`에 revision 프로토콜이 들어갔다(`docs/PRD-ui-renewal-2026-09-19.md` §8). 앱과 `firestore.rules`를 같은 릴리스로 배포한다.

- 한 번이라도 금액 연산을 거친 행에는 `revision`·`lastOperationId`가 찍힌다. 이후 그 행의 금액·상태·연결 거래를 바꾸는 쓰기는 `revision`을 정확히 1 올려야 하며, 그렇지 않으면 서버가 거부한다. 구버전 앱이 자기 로컬 복사본으로 덮어쓰는 경로가 여기서 차단된다.
- 이름·계좌 같은 메타데이터만 바꾸는 쓰기는 `revision`을 그대로 두면 허용된다.
- `amountChanges`는 추가만 가능하다(수정·삭제 거부).
- 클라이언트는 충돌을 재시도하지 않고 `brake_sync_conflicts`에 보관해 화면 상단 배너로 알린다. 실시간 스냅샷이 서버 값을 가져오므로 화면은 항상 이긴 값을 보여준다.

확인 항목:

1. 고정지출에서 금액을 확정한 뒤 Firestore 콘솔에서 해당 `recurringOccurrences` 문서에 `revision: 1`과 `amountChanges/{operationId}` 문서가 생겼는지 본다.
2. 같은 계정으로 두 브라우저를 열고 같은 항목의 금액을 각각 다른 값으로 저장한다. 늦은 쪽에 "다른 기기에서 먼저 수정한 항목" 배너가 뜨고, 두 화면 모두 먼저 저장된 값을 보여야 한다.
3. 오프라인에서 금액을 두 번 바꾼 뒤 온라인으로 돌아오면 두 변경이 순서대로 반영되고 미반영 건수가 0이 되는지 확인한다.
4. 규칙 배포 전 버전의 앱에서 이미 `revision`이 찍힌 항목의 금액을 바꾸면 저장이 거부되는지 확인한다(구버전 차단).

## 4. 운영 확인

- 새 브라우저에서 PIN 전에는 금융 데이터가 나타나지 않는다.
- PIN 성공 후 기존 데이터가 기본값으로 덮이지 않는다.
- 같은 브라우저에서 계정을 바꿔 로그인해도 로컬 캐시, 오프라인 대기 쓰기, 작성 중 초안이 섞이지 않는다.
- 계좌번호와 송금정보 복사가 동작한다.
- 계좌 잔액 수정 시 기준일이 저장된다.
- 같은 정기 건을 빠르게 두 번 처리해도 거래가 하나만 생성된다.
- AI 기능을 끄면 AI API 요청이 발생하지 않는다.
- GPT 라이브에서 마이크 권한, 응답 음성, 사용자 발화 자막, 대화 중 끼어들기가 동작한다.
- GPT가 만든 거래는 즉시 저장되지 않고 수정 가능한 확인 화면으로 이동한다.
- GPT에게 월 지출·잔액을 질문했을 때 계좌번호는 전송하거나 음성으로 읽지 않는다.
- GPT 라이브와 Gemini 음성이 독립 탭으로 표시되고 각 탭에서 마이크 권한 요청·복구가 동작한다.
- 영수증 촬영 후 OCR 결과를 수정할 수 있고, 저장한 원본은 거래 내역에서만 조회된다.
- 다른 UID 또는 로그아웃 상태에서 영수증 Storage 경로의 읽기·쓰기·목록 조회가 거부된다.
- 전체 초기화는 운영 백업을 확인하기 전 사용하지 않는다.

- “로그인 유지”를 끄고 로그인하면 12시간 뒤, 켜면 30일 뒤 AI 요청이 401을 받고 앱이 잠금 화면으로 돌아간다.

### 4-1. 세션 폐기 (2026-09-28 이후)

API 세션 토큰은 `v2:uid:epoch:만료:서명` 형식이다. 계정의 현재 epoch는 Firestore `sessionEpochs/{uid}`(클라이언트 접근 불가, 기본 거부 규칙에 포함)에 있다.

- 기기 분실 등으로 한 계정의 모든 세션을 끊으려면 Admin 자격 증명이 있는 곳에서 실행한다.
  ```bash
  npm run session:revoke -- owner
  ```
  epoch가 1 오르고 Firebase refresh token이 폐기된다. 서버는 epoch를 60초 캐시하므로 AI 요청은 1분 안에, Firestore 동기화는 기존 ID 토큰이 끝나는 1시간 안에 끊긴다.
- 사용자는 관리 화면 “PIN 로그인 보안” 카드의 “다른 기기에서 모두 로그아웃”으로 같은 일을 할 수 있다. 현재 기기는 새 세션을 받아 로그인 상태를 유지한다.
- 서버 오류 코드: 토큰 없음 `session_missing`, 서명 불일치 `session_invalid`, 만료 `session_expired`, 폐기 `session_revoked`는 모두 401이다. 계정 목록에 없는 uid만 403 `account_unknown`이다. epoch를 읽을 수 없고 캐시도 없으면 503을 반환한다.
- 이전 형식(`uid:만료:서명`) 토큰은 이번 배포 동안만 epoch 0으로 인정한다. **다음 배포에서 `src/server/session.ts`의 legacy 분기를 제거한다.**

## 5. 롤백

1. 문제가 생기면 강화된 rules와 앱을 직전 버전으로 되돌린다.
2. 기존 루트 컬렉션은 삭제하지 않았으므로 이전 앱은 기존 데이터를 다시 읽을 수 있다.
3. 소유자 경로에서 새로 생성된 변경분은 마이그레이션 보고서 이후 시각을 기준으로 별도 추출한다.
4. 원인 확인 전 마이그레이션 마커나 루트 데이터를 삭제하지 않는다.

## 주의

- 앱 코드와 rules를 검증 없이 동시에 배포하면 기존 앱이 먼저 차단될 수 있다.
- Cloud Run/Firebase Admin 자격증명이 없으면 PIN custom token 발급과 데이터 이관이 실패한다.
- 기존 루트 데이터 삭제는 이 변경의 범위에 포함되지 않는다.
