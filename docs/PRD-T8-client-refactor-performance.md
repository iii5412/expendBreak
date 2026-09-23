# T8. 클라이언트 구조 정리·성능·접근성 PRD

- 문서 상태: Draft v1.0
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

- [ ] `src/` 아래 600줄을 넘는 파일이 없다(테스트 제외).
- [ ] 분리 전후 `npm test` 결과가 같고 화면 동작이 같다.
- [ ] 영수증 화면을 열기 전에는 `firebase/storage` 코드가 로드되지 않는다(네트워크 탭 확인).
- [ ] 첫 화면 JS(gzip)가 기준값 대비 15% 이상 줄었다.
- [ ] 아이콘 전용 버튼이 모두 접근 가능한 이름을 가진다(`jsx-a11y` 경고 0건).
- [ ] `npm audit --omit=dev` moderate 이상 0건, 또는 남은 항목의 사유가 기록돼 있다.
