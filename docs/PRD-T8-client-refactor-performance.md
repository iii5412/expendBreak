# T8. 클라이언트 구조 정리·성능·접근성 PRD

- 문서 상태: R2·R4·R5 구현 완료 v1.1 (2026-10-01), R1·R3 대기
- 작성일: 2026-09-23
- 우선순위: P2 (R4 접근성은 P3)
- 예상 규모: 1~2주(점진 진행)
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md), [T5](./PRD-T5-sync-storage-resilience.md)

## 1. 배경

| 파일 | 줄 수 | 문제 |
|---|---|---|
| `components/ManagementView.tsx` | 2,053 | 설정 화면 전체 + 반복 규칙·카테고리·빠른 입력·AI 설정이 한 컴포넌트 |
| `utils/storage.ts` | 2,030 | export 함수 74개. 모든 컬렉션의 읽기·쓰기·마이그레이션이 한 모듈 |
| `App.tsx` | 1,821 | `useState` 29개, `useEffect` 16개. 정기 결제 게시·건너뛰기 같은 도메인 핸들러 포함 |
| `components/AddTransactionModal.tsx` | 1,702 | 수동·AI·음성·영수증 입력 경로가 한 파일 |

번들(현재 `dist`, 미압축): `firebase` 704KB(초기 로드), `react-vendor` 236KB, `index` 228KB, `charts` 392KB(분석 화면에서 지연 로드 — 양호).

- `lib/firebase.ts`가 `firebase/storage`를 즉시 초기화한다. 영수증 화면에서만 쓴다.
- `vite.config.ts:139-144`의 `manualChunks`가 `motion`을 `react-vendor`에 넣어 초기 로드에 포함시킨다.
- 스냅샷마다 `App` 상태가 갱신돼 하위 트리 전체가 다시 렌더링될 가능성이 크다.
- 컴포넌트의 `<button>` 244개 대비 `aria-label`은 75개다.

## 2. 목표

1. 기능 변경 없이 대형 파일을 책임 단위로 나눈다.
2. 첫 화면 JS를 줄이고, 데이터 변경 시 불필요한 렌더링을 줄인다.
3. 아이콘 전용 버튼이 스크린리더에서 이름을 갖는다.

## 3. 요구사항

### R1. 모듈 분리

- `storage.ts` → `storage/` 디렉터리의 컬렉션별 리포지토리(`transactions.ts`, `recurring.ts`, `accounts.ts`, `categories.ts`, `profile.ts`, `migrations.ts`)와 공개 API를 모은 `index.ts`. 기존 import 경로는 `index.ts` 재수출로 유지해 한 번에 바꾸지 않는다.
- `App.tsx` → 도메인 훅 `useRecurringActions`, `useTransactionActions`, `useSyncLifecycle`, `useAppLock`. `App`은 레이아웃과 라우팅만 담당한다.
- `ManagementView.tsx` → 섹션 컴포넌트(`RecurringRulesSection`, `CategorySection`, `QuickEntrySection`, `AiSettingsSection`, `DataSection`).
- `AddTransactionModal.tsx` → 입력 방식별 패널과 공통 확인 폼.
- 파일 하나당 600줄 이하를 목표로 한다. 분리마다 기존 테스트(`auditUI.test.tsx` 등)가 통과해야 한다.

### R2. 번들

- `receiptStorage` 초기화를 `utils/receiptStorage.ts` 안의 동적 `import('firebase/storage')`로 옮긴다.
- `manualChunks`에서 `motion`을 별도 청크로 분리하고, 첫 화면에서 쓰지 않으면 지연 로드한다.
- `rollup-plugin-visualizer`로 빌드 리포트를 만들고, 첫 화면 JS(gzip) 수치를 이 문서에 기록한다.
- 목표: 첫 화면 JS(gzip) 현재 대비 15% 이상 감소.

### R3. 렌더링

- React Profiler로 “거래 1건 추가” 시 커밋 시간을 측정해 기준값을 남긴다.
- 무거운 목록(`HistoryView`)과 카드에 `React.memo`, 선택자 기반 구독(T5 2단계 스토어)을 적용한다.
- `HistoryView`가 500건 이상을 한 번에 그리면 가상 스크롤을 검토한다.

### R4. 접근성 (P3)

- 아이콘만 있는 버튼(닫기, 삭제, 더보기, 금액 수정)에 `aria-label`을 붙인다.
- 금액의 증감·상태를 색상만으로 구분하는 곳에 기호나 텍스트(`+`, `-`, “초과”)를 추가한다.
- `eslint-plugin-jsx-a11y`를 T4의 ESLint에 추가한다(처음에는 `warn`).
- Android TalkBack으로 홈 → 거래 추가 → 저장 흐름을 확인한다(`IMPLEMENTATION-STATUS.md`에 미검증으로 남아 있음).

### R5. 의존성·잔재 정리

- 마이너 업데이트: Capacitor 8.0.0→8.5.2, firebase 12.17.1→12.19.0, firebase-admin 14.2.0→14.4.0, @google/genai 2.16.0→2.24.0. `npm audit`의 moderate 9건(`teeny-request`/`retry-request` 계열) 해소 여부를 확인한다.
- `package.json` `name`을 `expendbreak`로 바꾸고, `vite` 중복 선언(dependencies/devDependencies)을 정리한다. `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite`는 devDependencies로 옮긴다.
- AI Studio 템플릿 잔재(`metadata.json`, `firebase-blueprint.json`)가 쓰이지 않으면 삭제한다.
- 완료된 PRD를 `docs/archive/`로 옮기고 `IMPLEMENTATION-STATUS.md`를 단일 진입점으로 삼는다.

## 4. 수용 기준

- [ ] `src/` 아래 600줄을 넘는 파일이 없다(테스트 제외). **미충족** (R1 미착수. `ManagementView.tsx`, `storage.ts`, `App.tsx`, `AddTransactionModal.tsx`가 여전히 크다)
- [ ] 분리 전후 `npm test` 결과가 같고 화면 동작이 같다. (R1 미착수라 해당 없음)
- [x] 영수증 화면을 열기 전에는 `firebase/storage` 코드가 로드되지 않는다. (빌드 결과 `firebase-storage` 청크 52KB, 첫 화면 `index.html`이 불러오는 JS는 3개뿐이다. 빌드한 앱을 브라우저로 열어 로드된 JS 파일 목록으로 확인했다)
- [x] 첫 화면 JS(gzip)가 기준값 대비 15% 이상 줄었다. (**323,481 → 196,858바이트, −39%**. 아래 참조)
- [x] 아이콘 전용 버튼이 모두 접근 가능한 이름을 가진다. (`jsx-a11y`는 사용자 정의 컴포넌트를 "텍스트를 그릴 수 있음"으로 가정해 아이콘 버튼을 못 잡는다. 대신 TypeScript AST로 검사하는 `src/a11y/iconButtons.test.ts`를 추가했고, `aria-label` 하나를 지워 보니 실제로 실패하는 것을 확인했다. 현재 위반 0건)
- [ ] `npm audit --omit=dev` moderate 이상 0건, 또는 남은 항목의 사유가 기록돼 있다. (사유를 아래에 기록: 6건 남음)

## 5. 구현 결과

### R2 번들 (첫 화면 JS, gzip, `index.html`이 불러오는 파일 합계)

| 시점 | 합계 | 구성 |
|---|---|---|
| 기준 (T8 시작 전) | 323,481 B | index 75.3K + react-vendor 71.1K + firebase(전체) 177.0K |
| 최종 | **196,858 B (−39.1%)** | index 74.4K + react-vendor 71.1K + firebase(app·auth) 51.3K |

- `firebase/storage`를 `utils/receiptStorage.ts`의 동적 `import()`로 옮겼다(별도 `firebase-storage` 청크 12.2KB gzip). 이것만으로는 −2.5%였다.
- **큰 몫은 Firestore(117KB gzip)를 첫 화면에서 분리한 것이다.** 로그인 화면은 `firebase/auth`만 필요하고 Firestore는 로그인 후에야 쓰인다. 구조:
  - `utils/firestoreOutbox.ts`: 오프라인 아웃박스·충돌·히스토리 하한·스냅샷 겹쳐 얹기 조회. Firebase 코드가 없어 첫 화면에 남는다.
  - `utils/firestoreWrites.ts`: 각 쓰기를 데이터(`WriteSpec`)로 만드는 함수들.
  - `utils/firestoreSync.ts`: 실제 Firestore 코드. 별도 청크로 지연 로드된다.
  - `utils/cloudSync.ts`: 기존 API를 그대로 유지하는 지연 로딩 파사드. `storage.ts`와 컴포넌트는 이것을 import한다.
  - **데이터 유실 방지**: 파사드는 쓰기를 **청크를 요청하기 전에** 아웃박스에 먼저 넣는다. 청크가 아직 오는 중이거나 오프라인이라 못 받아도 변경은 남고, 청크가 도착하거나 다음 재시도 때 전송된다(테스트로 확인). 로드 실패는 "저장 모듈을 불러오지 못했습니다"로 표시한다.
  - `lib/firebase.ts`(app·auth)와 `lib/firestore.ts`(db)로 나눴다.
- `motion` 패키지는 어디에서도 import되지 않아 제거했다(PRD의 "별도 청크 분리" 대신 삭제).
- `vite.config.ts`의 `manualChunks`: `firebase-storage`, `firebase-firestore`를 분리했다.
- `rollup-plugin-visualizer`는 넣지 않았다. 청크별 크기는 빌드 출력과 위 스크립트(`dist/index.html`이 참조하는 JS를 gzip)로 확인했다.
- 한계: 로그인 직후에는 Firestore 청크를 받아야 해서 첫 동기화가 청크 다운로드만큼 늦어진다. 캐시가 있는 재방문(웜 부팅)은 화면을 캐시로 먼저 그리므로 영향이 작고, 서비스 워커가 모든 청크를 미리 캐시한다. 느린 회선에서의 실제 체감은 측정하지 못했다.

### R4 접근성

- 위 AST 검사 테스트가 아이콘 전용 `<button>`/`<a>`의 이름 유무를 막는다.
- `eslint-plugin-jsx-a11y`를 `warn`으로 추가했다(`label-has-associated-control` 58, `no-autofocus` 7 등 약 70건 + 기존 경고). 폐기 예정 규칙 `label-has-for`는 껐다.
- **하지 않은 것**: 금액 증감·상태를 색만으로 구분하는 곳에 기호·텍스트 추가(곳을 전수 조사하지 못했다), TalkBack 실기기 확인(`IMPLEMENTATION-STATUS.md`에 계속 미검증).

### R5 의존성·잔재

- 갱신: `firebase` 12.19.0, `firebase-admin` 14.5.0, `@google/genai` 2.25.0, `express` 4.22.3(범위 내 업데이트) 및 `npm audit fix`. `npm audit --omit=dev`는 moderate 9건 → 6건(high 4, moderate 2)으로 줄었다.
- **남은 6건과 사유**: `@grpc/grpc-js`(`@firebase/firestore` 웹 SDK 경유, high 4건)와 `uuid`(`gaxios` 경유, moderate 2건). npm이 제시하는 해결책은 `firebase@9.14.0`으로의 **주 버전 다운그레이드**여서 적용하지 않았다. 웹 SDK의 gRPC 취약점은 브라우저 번들에서 쓰이지 않는 Node용 전송 계층이다. 상위 패키지가 의존성을 올릴 때까지 추적한다.
- **Capacitor 8.0.0 → 8.5.x는 적용하지 않았다**(`@capacitor/cli`만 audit fix로 8.5.2가 됐다). 네이티브 Android 빌드와 `cap sync`를 이 환경에서 검증하지 못해, 웹 번들만 확인된 상태로 올리면 위험하다. Android 빌드를 확인할 수 있을 때 한 번에 올린다.
- `package.json` `name`을 `expendbreak`로 바꾸고, `vite`·`@vitejs/plugin-react`·`@tailwindcss/vite`를 devDependencies로 정리했다.
- **`.npmrc`에 `legacy-peer-deps=true`를 추가했다.** `eslint-plugin-jsx-a11y`가 아직 ESLint 10 peer를 선언하지 않아서다. 이 설정은 peer 의존성을 자동 설치하지 않아 빌드가 한 번 깨졌고(`recharts`가 요구하는 `react-is`), `react-is`를 직접 의존성으로 선언해 해결했다. jsx-a11y가 ESLint 10을 지원하면 이 설정을 지운다.
- `metadata.json`, `firebase-blueprint.json`(AI Studio 템플릿 잔재, 코드에서 참조 없음)을 삭제했다.
- 완료된 PRD(T1~T4, T6, T7)와 일회성 진단 문서 3건을 `docs/archive/`로 옮기고 링크를 고쳤다. `IMPLEMENTATION-STATUS.md`에 이번 개선 작업의 현황 절을 추가했다.

## 6. 하지 않은 것: R1(모듈 분리)과 R3(렌더링)

- **R1**: 대형 파일 네 개를 나누는 일은 기능을 건드리지 않는 순수 이동이어야 하는데, 이 환경에서는 로그인된 실제 앱을 돌려 화면 동작을 대조할 수 없다(개발 환경에 Firebase 인증이 없다). `ManagementView`(2,000줄 이상)와 `AddTransactionModal`은 상태 수십 개를 공유하고, `storage.ts`는 모듈 수준 상태(`storageReady`, `sessionGeneration`)에 얽혀 있다. 확인할 수단 없이 옮기면 눈에 띄지 않는 회귀를 만들 위험이 커서 착수하지 않았다. 권장 순서: ① 로그인된 환경에서 화면 단위 스모크 테스트(Playwright)를 먼저 만든다 → ② `storage.ts`를 컬렉션별로 나누고 `index.ts` 재수출로 호환 유지 → ③ `ManagementView`, `App`, `AddTransactionModal` 순으로 분리한다. 이번 작업에서 만든 `cloudSync` 파사드와 `firestoreOutbox`/`firestoreWrites` 분리는 이 방향의 첫 단계이기도 하다.
- **R3**: React Profiler로 "거래 1건 추가" 기준값을 재려면 로그인된 앱이 필요해 측정하지 못했다. `React.memo`와 스토어 구독은 T5 2단계(메모리 스토어)와 함께 진행하는 것이 맞다.
