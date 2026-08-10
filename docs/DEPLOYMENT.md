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

필수 환경변수:

- `APP_PIN_HASH`: 위 명령으로 생성한 값
- `OWNER_UID`: 단일 소유자 UID. 기본값은 `owner`
- `GEMINI_API_KEY`: AI 기능을 사용할 경우
- `NODE_ENV=production`
- `PORT`: 호스팅 플랫폼이 주입

`APP_ACCESS_KEY`는 기존 배포 호환용 임시 fallback이다. `APP_PIN_HASH` 확인 후 제거한다.

## 2. 1차 배포 — 앱과 서버

1. `storage.rules`를 운영 Storage에 배포한다. 영수증 원본은 이 규칙 없이는 저장되지 않아야 한다.
2. 새 앱과 서버를 배포하되 Firestore rules는 아직 기존 상태로 둔다.
3. PIN으로 최초 로그인한다.
4. 서버가 `/api/migration/ensure`를 실행하여 루트 컬렉션을 소유자 경로로 복사한다.
5. `users/{OWNER_UID}/migrations/legacy-root-v1` 보고서가 생성됐는지 확인한다.
6. 각 컬렉션의 `sourceCount`, `destinationCount`와 거래 `sourceAmountTotal`, `destinationAmountTotal`을 확인한다.
7. `classificationIssues`의 거래·정기 항목 불일치 건수와 금액을 기록한다.
8. 대시보드 월별 수입·지출, 계좌, 정기 항목을 기존 앱과 대조한다.

마이그레이션은 원본을 삭제하지 않는다. 검증 실패 시 클라이언트는 데이터를 로드하지 않고 원본은 그대로 남는다.

## 3. 2차 배포 — Firestore rules

1. 1차 검증이 끝난 뒤 저장소의 `firestore.rules`를 배포한다.
2. PIN이 없을 때 Firestore 요청이 거부되는지 확인한다.
3. 올바른 PIN 로그인 후 조회·추가·수정·삭제가 가능한지 확인한다.
4. 유형과 맞지 않는 카테고리로 거래 또는 정기 항목 저장이 거부되는지 확인한다.
5. 설정의 `분류 무결성 점검`에서 기존 불일치 건수를 확인한다.

## 4. 운영 확인

- 새 브라우저에서 PIN 전에는 금융 데이터가 나타나지 않는다.
- PIN 성공 후 기존 데이터가 기본값으로 덮이지 않는다.
- 계좌번호와 송금정보 복사가 동작한다.
- 계좌 잔액 수정 시 기준일이 저장된다.
- 같은 정기 건을 빠르게 두 번 처리해도 거래가 하나만 생성된다.
- AI 기능을 끄면 AI API 요청이 발생하지 않는다.
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
