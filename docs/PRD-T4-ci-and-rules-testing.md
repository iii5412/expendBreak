# T4. CI, 보안 규칙 테스트, 규칙 배포 자동화 PRD

- 문서 상태: 구현 완료 v1.1 (2026-10-01), 운영 설정 대기
- 작성일: 2026-09-23
- 우선순위: P1
- 예상 규모: 1.5~2일
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md), [DEPLOYMENT.md](./DEPLOYMENT.md)

## 1. 배경

- 로컬 기준 `tsc --noEmit` 오류 0건, Vitest 49개 파일 362개 테스트가 모두 통과한다. 하지만 CI가 없어(`.github/workflows` 없음) 이 상태를 지켜 줄 장치가 없다.
- 핵심 불변식(리비전 보호, `amountChanges` append-only, 계정 간 격리)이 `firestore.rules`에만 있고 테스트가 없다. `IMPLEMENTATION-STATUS.md`도 “revision 규칙은 에뮬레이터 검증 전”이라고 적고 있다.
- `firebase.json`이 없어 규칙을 콘솔에서 수동 배포한다. 커밋 `22dbc9e`(“sync firestore.rules with production”)는 저장소와 운영이 이미 어긋났던 적이 있음을 보여 준다.
- ESLint가 없어 `useEffect` 16개가 있는 `App.tsx`의 의존성 배열 누락을 잡지 못한다.

## 2. 목표

1. 모든 push·PR에서 타입 검사, 테스트, 빌드가 자동으로 돈다.
2. 보안 규칙의 핵심 불변식이 에뮬레이터 테스트로 보호된다.
3. 저장소의 규칙 파일이 운영 규칙의 유일한 출처가 된다.

### 비목표

- 앱·서버 자동 배포(CD). 이번에는 규칙 배포만 자동화한다.
- Android APK 서명 빌드 자동화.

## 3. 요구사항

### R1. CI 워크플로

`.github/workflows/ci.yml`:

| 단계 | 명령 | 비고 |
|---|---|---|
| 설치 | `npm ci` | Node 22, npm 캐시 |
| 타입 | `npm run lint` | 현재 `tsc --noEmit` |
| ESLint | `npm run lint:eslint` | R4 도입 후 |
| 단위 테스트 | `npm test` | |
| 규칙 테스트 | `npm run test:rules` | Firebase 에뮬레이터, Java 21 |
| 빌드 | `npm run build` | 웹 + 서버 번들 |

- `main` 대상 PR과 `main` push에서 실행한다. 실패 시 머지를 막도록 브랜치 보호를 설정한다(저장소 설정, 수동).
- 잠금 파일은 `package-lock.json` 하나로 통일하고 `bun.lock`을 삭제한다.

### R2. Firestore·Storage 규칙 테스트

- 의존성: `@firebase/rules-unit-testing`, `firebase-tools`(dev).
- 위치: `tests/rules/firestore.rules.test.ts`, `tests/rules/storage.rules.test.ts`. 별도 Vitest 설정(`vitest.rules.config.ts`)으로 단위 테스트와 분리한다.
- 최소 시나리오:

| 영역 | 시나리오 | 기대 |
|---|---|---|
| 격리 | `owner`가 `users/wife/transactions` 읽기 | 거부 |
| 격리 | 비로그인 사용자가 `users/owner` 읽기 | 거부 |
| 격리 | 루트 `transactions` 컬렉션 읽기 | 거부 |
| 거래 | `amount: 0`, 음수, 문자열 | 거부 |
| 거래 | `categoryId`의 유형이 거래 유형과 다름 | 거부 |
| 리비전 | 게시된 정기 결제 거래 금액을 revision 증가 없이 변경 | 거부 |
| 리비전 | revision을 되돌리는 `recurringOccurrences` 업데이트 | 거부 |
| 감사 | `amountChanges` 수정·삭제 | 거부 |
| 감사 | `id`와 문서 ID가 다른 `amountChanges` 생성 | 거부 |
| 설정 | `appSettings`에 `accessPin` 필드 쓰기 | 거부 |
| 마이그레이션 | 클라이언트가 `migrations` 쓰기 | 거부 |
| Storage | `original.jpg` 외 파일명, 8MB 초과, `image/png` | 거부 |

### R3. 규칙 배포 자동화

- `firebase.json`과 `.firebaserc`를 추가한다. `firestore.rules`, `storage.rules`, 데이터베이스 ID(`firebase-applet-config.json`의 `firestoreDatabaseId`)를 명시한다.
- `.github/workflows/deploy-rules.yml`: `main`에서 규칙 파일이 바뀌면 `firebase deploy --only firestore:rules,storage`를 실행한다. 인증은 GitHub OIDC + Workload Identity Federation을 사용하고, 서비스 계정 키 JSON은 저장하지 않는다.
- 첫 적용 전에 `firebase firestore:rules:get`(또는 콘솔)으로 운영 규칙과 저장소 규칙이 같은지 확인한다.

### R4. ESLint·Prettier

- `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks`(recommended). 첫 도입 시 `react-hooks/exhaustive-deps`는 `warn`으로 두고 경고 수를 기록한다.
- Prettier는 현재 스타일(작은따옴표, 세미콜론, 2칸)에 맞춘 설정만 추가하고, 전체 재포맷은 별도 커밋으로 분리한다.

## 4. 수용 기준

- [ ] PR을 열면 CI가 자동 실행되고, 테스트 하나를 일부러 깨뜨리면 실패한다. (`.github/workflows/ci.yml` 작성. GitHub에서 실제로 돌려 보지는 않았다. 같은 명령을 로컬에서 모두 통과시켰다)
- [x] `npm run test:rules`가 R2 표의 시나리오를 통과한다. (로컬 에뮬레이터에서 31개 통과. `amountChanges` 규칙을 일부러 약화하면 해당 테스트가 실패하는 것을 확인했다. CI 통과는 위와 같이 미확인)
- [ ] 규칙 파일만 바꾼 커밋이 `main`에 들어가면 운영 규칙이 자동 갱신된다. (`deploy-rules.yml`, `firebase.json`, `.firebaserc` 작성. 아래 운영 설정 전에는 동작하지 않으며 배포는 시험하지 못했다)
- [x] 저장소에 서비스 계정 키 파일이 없다. (OIDC 방식. `bun.lock`도 삭제)
- [x] `IMPLEMENTATION-STATUS.md`의 “에뮬레이터 검증 전” 문구를 제거했다.

## 5. 구현 메모와 남은 운영 설정

- 규칙 테스트는 `tests/rules/`에 있고 `vitest.rules.config.ts`로 분리했다. 일반 `npm test`는 `vite.config.ts`의 `test.exclude`로 이 폴더를 건너뛴다. 에뮬레이터에는 Java 21이 필요하다(로컬 PATH의 Java 17로는 실행하지 않았다. 이 저장소의 `.jdk21`을 `JAVA_HOME`으로 지정했다). 서버 전용 컬렉션(`sessionEpochs`, `system`)이 클라이언트에 막혀 있는지도 테스트에 포함했다.
- ESLint(R4): `eslint` + `typescript-eslint` + `react-hooks`. 첫 도입 결과 오류 0건, 경고 198건(`no-explicit-any` 143, `exhaustive-deps` 21, 미사용 변수 21 등). `no-useless-escape`, `no-control-regex`는 기존 코드에 걸려 경고로 낮췄다. 도입 중 `rules-of-hooks` 위반 1건이 나왔으나 `use`로 시작하는 일반 함수명 때문이어서 이름만 바꿨다. 사소한 `prefer-const` 2건도 고쳤다. Prettier는 설정(`.prettierrc.json`)만 추가했고 전체 재포맷은 하지 않았으며 `format:check`는 CI에 넣지 않았다.
- **운영 설정(수동, 저장소 밖)**
  1. 첫 배포 전에 운영 규칙과 저장소 규칙이 같은지 확인한다(`firebase firestore:rules:get` 또는 콘솔).
  2. GCP에 Workload Identity Federation 풀·공급자와 규칙 배포용 서비스 계정을 만들고, 저장소 변수 `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`를 등록한다.
  3. 브랜치 보호에서 CI(`verify`) 통과를 머지 조건으로 지정한다.
- 알려진 한계: 규칙 배포는 이름 있는 데이터베이스(`firebase.json`의 `firestore[].database`)를 대상으로 한다. 배포는 시험하지 못했으므로 첫 실행 로그를 확인한다.
