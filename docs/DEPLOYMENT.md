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

출력 전체를 운영 secret `APP_PIN_HASH`에 저장한다. 실제 PIN과 hash는 Git에 커밋하지 않는다.

배우자처럼 데이터를 완전히 분리할 추가 계정은 별도 PIN으로 생성한다.

```powershell
npm run account:hash -- wife "와이프" 654321
```

출력된 JSON 전체를 운영 secret `APP_ACCOUNTS_JSON`에 저장한다. 여러 계정이면 같은 배열 안에 항목을 추가한다. UID와 PIN은 계정마다 달라야 한다. 기존 계정은 계속 `users/{OWNER_UID}`를 사용하고, 위 예시 계정은 `users/wife`를 사용한다.

필수 환경변수:

- `APP_PIN_HASH`: 위 명령으로 생성한 값
- `OWNER_UID`: 기존 데이터 소유자 UID. 기본값은 `owner`
- `OWNER_NAME`: 기존 계정에 표시할 이름. 기본값은 `내 계정`
- `APP_ACCOUNTS_JSON`: 추가 계정의 `uid`, 표시 이름, PIN hash 배열
- `APP_SESSION_SECRET`: 세션 서명용 긴 임의 문자열. 다중 계정 운영에서는 명시적으로 설정 권장
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

`APP_ACCESS_KEY`는 기존 배포 호환용 임시 fallback이다. `APP_PIN_HASH` 확인 후 제거한다.

## 2. 1차 배포 — 앱과 서버

1. `storage.rules`를 운영 Storage에 배포한다. 영수증 원본은 이 규칙 없이는 저장되지 않아야 한다.
2. 새 앱과 서버를 배포하되 Firestore rules는 아직 기존 상태로 둔다.
3. 웹과 Android 앱에서 PIN으로 최초 로그인한다. `/api/auth/verify-key`가 API 세션 토큰과 Firebase custom token을 모두 반환해야 한다.
4. 서버가 `/api/migration/ensure`를 실행하여 루트 컬렉션을 소유자 경로로 복사한다.
5. `users/{OWNER_UID}/migrations/legacy-root-v1` 보고서가 생성됐는지 확인한다.
6. 각 컬렉션의 `sourceCount`, `destinationCount`와 거래 `sourceAmountTotal`, `destinationAmountTotal`을 확인한다.
7. `classificationIssues`의 거래·정기 항목 불일치 건수와 금액을 기록한다.
8. 대시보드 월별 수입·지출, 계좌, 정기 항목을 기존 앱과 대조한다.
9. 추가 계정 PIN으로 로그인해 빈 독립 가계부가 생성되고, 기존 소유자 데이터가 보이지 않는지 확인한다.

마이그레이션은 원본을 삭제하지 않는다. 검증 실패 시 클라이언트는 데이터를 로드하지 않고 원본은 그대로 남는다.

## 3. 2차 배포 — Firestore rules

1. 1차 검증이 끝난 뒤 저장소의 `firestore.rules`를 배포한다.
2. PIN이 없을 때 Firestore 요청이 거부되는지 확인한다.
3. 올바른 PIN 로그인 후 조회·추가·수정·삭제가 가능한지 확인한다.
4. 각 계정에서 다른 계정의 `users/{uid}` 경로 읽기·쓰기가 거부되는지 확인한다.
5. 유형과 맞지 않는 카테고리로 거래 또는 정기 항목 저장이 거부되는지 확인한다.
6. 설정의 `분류 무결성 점검`에서 기존 불일치 건수를 확인한다.

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

## 5. 롤백

1. 문제가 생기면 강화된 rules와 앱을 직전 버전으로 되돌린다.
2. 기존 루트 컬렉션은 삭제하지 않았으므로 이전 앱은 기존 데이터를 다시 읽을 수 있다.
3. 소유자 경로에서 새로 생성된 변경분은 마이그레이션 보고서 이후 시각을 기준으로 별도 추출한다.
4. 원인 확인 전 마이그레이션 마커나 루트 데이터를 삭제하지 않는다.

## 주의

- 앱 코드와 rules를 검증 없이 동시에 배포하면 기존 앱이 먼저 차단될 수 있다.
- Cloud Run/Firebase Admin 자격증명이 없으면 PIN custom token 발급과 데이터 이관이 실패한다.
- 기존 루트 데이터 삭제는 이 변경의 범위에 포함되지 않는다.
