# Task 3: 기존 Firebase 연결·정기 항목·초기 설정

## 진입과 저장

- 실제 계정: `npm run dev` 실행 후 `http://localhost:3000/?view=budget` (포트 변경 시 해당 포트).
- 로컬 체험: `budget-app.html?mode=local`. 별도 `eb_budget_local_preview_v1` 키에 저장하며 Firebase에는 전송하지 않는다. 현재 날짜를 사용한다. 기본 개발용 HTML도 이 모드다.
- Task 2 고정 목업: `budget-app.html?mode=mock`.

실제 화면은 기존 App의 PIN·세션·마이그레이션·잠금 처리가 끝나야 열린다. 소유자와 배우자 UID 분리, storage 구독, Firestore 실시간 수신, 오프라인 outbox, 충돌 알림을 재사용한다. 계정이 바뀌면 이전 작업은 가드로 거부한다. 기존 화면은 `/`로 유지한다. 개발용 HTML은 운영 빌드에 포함하지 않지만 연결 화면은 쿼리 경로로 번들에 포함된다. 배포나 push는 하지 않는다.

기존 문서는 이관하거나 덮어쓰지 않는다. 새 거래의 `budgetPeriodKey`, `expenseNature`, `isOneOff`, 회차의 `budgetPeriodKey`, 예산·프로필의 `categoryCountLimits`는 선택 필드다. 기존 문서는 읽을 때 정기 연결·예정일·급여일 이력으로 변환한다. 조기 시작·주기 변경 경계도 코어에 명시적으로 전달한다. 이체·카드 대금은 소비에서 제외하고 할부는 이번 주기 회차 금액만 사용한다. 신규 계정의 관측이 3일 미만이면 예측은 데이터 부족이다. 미확정 예정 금액이 있으면 잔액과 예측이 참고값임을 알린다.

## 정기 항목과 온보딩

관리에서 수입/지출, 카테고리, 금액, 매월 예정일, 휴일 정책, 확인/자동 반영, 고정/변동 성격을 지정한다. 중지·재개·보관·복원이 가능하고 거래 이력을 삭제하지 않는다. 템플릿 편집은 이미 만들어진 현재 회차의 확인 금액과 독립적이다.

자동 반영은 새 화면에서 명시적으로 선택한 `budgetAutoPostingEnabled` 고정 금액 항목만 대상으로 한다. 기존 auto 템플릿은 이 동의 없이 반영하지 않는다. 기존 항목에 자동 반영을 처음 켜면 다음 주기부터 적용한다. 현재 주기·자동 적용 시작일 이후·예정일 도래·미반영·미건너뜀을 모두 확인한다. 저장은 기존 `postOccurrenceToTransaction`, 결정적 거래 ID, 조건부 연산을 사용한다. 회차와 연결 거래 revision은 기존 프로토콜에 따라 1 증가한다. 실패는 수동 확인으로 안내한다.

주말은 자동 조정하고 공휴일·은행 휴무일은 항목별 추가 휴무일에 등록한다. 외부 공휴일 달력을 자동 조회하지 않는다. 주기를 벗어나는 날짜 조정은 기존 앱의 주기 보존 규칙을 유지한다. 실제 조기 입금 날짜와 주기 키는 분리해 보관한다.

거래·기존 정기 항목·예산이 없는 신규 계정에 월급, 급여일, 고정비, 변동 한도, 배달 쿠폰 초기 설정을 연다. 기존 계정에는 재설정을 요구하지 않는다. 부분 저장 재시도는 템플릿 역할 표식으로 중복을 방지한다. 완료/건너뜀은 기존 onboardingCompletedAt에 기록한다.

## 설정과 검증 한계

기본은 기존 Firebase 웹 설정이다. 환경변수로 대체하려면 `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`을 모두 지정한다. 필요에 따라 `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_DATABASE_ID`를 지정한다. 웹 설정은 빌드 시 주입하며 PIN 서버의 Firebase Admin 대상과 같은 프로젝트여야 한다. 서버 자격 증명·PIN·세션 키를 VITE 변수에 넣으면 안 된다.

현재 로컬 개발 서버에는 Google 서버 자격 증명이 없어 실제 계정 로그인·동기화는 실연동 검증하지 못했다. 운영 데이터에는 쓰지 않았다. 로컬 체험, 계정 변환 및 정기 반영 단위 테스트, 기존 금액 연산·동기화 테스트, 타입 검사, 운영 빌드로 검증한다. 보안 규칙은 변경하지 않는다.

검증 명령: `npm run lint`, `npm test`, `npm run build` 통과. 새 모듈은 ESLint 경고 없이 검사했다. 기본 전체 ESLint는 기존 build/live-bundle-web 생성물을 검사해 실패했으며, build 디렉터리를 제외하면 오류 0개·기존 경고 237개다. 생성물이나 관련 없는 기존 소스는 수정하지 않았다.
