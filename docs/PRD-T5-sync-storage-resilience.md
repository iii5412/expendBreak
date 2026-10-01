# T5. 로컬 캐시·동기화 복원력 PRD

- 문서 상태: 1단계 구현 완료 v1.1 (2026-10-01), 2단계 대기
- 작성일: 2026-09-23
- 우선순위: 1단계 P1, 2단계 P2
- 예상 규모: 1단계 1~2일, 2단계 1~2주
- 관련 문서: [개선사항 인덱스](./PRD-2026-09-23-improvements-index.md)

## 1. 배경

앱은 `localStorage`를 단일 데이터 저장소처럼 쓴다.

- 모든 `onSnapshot`이 컬렉션 전체를 `JSON.stringify`해 `localStorage`에 쓰고(`firestoreSync.ts:575-641`), 화면은 다시 파싱해 읽는다. 문서 한 건 변경에도 전체 직렬화·파싱이 반복된다.
- 브라우저 한도(약 5MB)를 넘으면 `setItem`이 `QuotaExceededError`를 던진다. 스냅샷 콜백에 처리가 없어 해당 컬렉션 동기화가 조용히 멈출 수 있다.
- 영수증 `rawText`(최대 5,000자)와 기간 제한 없이 구독하는 `recurringOccurrences`가 용량을 계속 키운다. 거래는 최근 기간만 구독한다(`transactionWindowStart`).
- 오프라인 쓰기는 자체 아웃박스(`brake_firestore_outbox`)에 쌓인다. 스냅샷이 도착하면 로컬 캐시를 통째로 교체하는데, 아웃박스의 미전송 변경을 다시 얹는 로직이 없다. 앱 재시작 직후 flush보다 스냅샷이 먼저 오면 방금 입력한 내용이 잠시 사라져 보일 수 있다(재현 확인 필요).
- `clearFirestoreAllData`(`firestoreSync.ts:800-829`)는 중간 실패를 로그로만 남겨, 초기화가 일부만 된 채 성공처럼 보일 수 있다.

## 2. 목표

1. 용량 초과·쓰기 실패가 사용자에게 보이고 데이터 유실로 이어지지 않는다(1단계).
2. 미전송 로컬 변경이 스냅샷에 가려지지 않는다(1단계).
3. 장기적으로 `localStorage` 의존을 제거해 데이터 양과 무관한 성능을 확보한다(2단계).

## 3. 요구사항 — 1단계 (P1)

### R1. 안전한 로컬 쓰기

- `safeSetItem(key, value)` 헬퍼를 만들고 `firestoreSync.ts`, `storage.ts`의 `localStorage.setItem` 호출을 모두 교체한다.
- `QuotaExceededError` 발생 시:
  1. 재생성 가능한 캐시(과거 거래 기록 창, AI 리포트 캐시)를 먼저 비우고 한 번 재시도한다.
  2. 그래도 실패하면 `syncStatus`에 `storage_full` 상태를 보고하고, `SyncStatusIndicator`에 “기기 저장 공간이 부족해 일부 데이터를 표시하지 못합니다” 배너를 띄운다.
- 아웃박스 쓰기 실패는 절대 삼키지 않는다. 호출자에게 예외를 전달해 저장 버튼이 실패를 표시하게 한다.

### R2. 캐시 크기 줄이기

- 로컬 캐시에 저장하는 거래에서 `receipt.rawText`, `receipt.lineItems`를 제외한다. 상세 모달(`ReceiptDetailsModal`)은 Firestore에서 개별 문서를 읽는다.
- `recurringOccurrences` 구독을 거래와 같은 기간 창으로 제한하고, 과거는 필요할 때 조회한다.
- 설정 > 진단에 키별 `localStorage` 사용량(KB)을 표시한다.

### R3. 아웃박스 오버레이

- 먼저 재현 테스트를 작성한다: 오프라인에서 거래 추가 → 앱 재시작 → 온라인 복귀 시 flush 전에 스냅샷 도착.
- 재현되면 스냅샷 반영 함수에 `applyPendingWrites(collection, docs)`를 추가한다. 아웃박스의 `set`/`delete`/`conditional` 항목을 순서대로 스냅샷 결과 위에 적용한 뒤 저장한다.

### R4. 전체 초기화 오류 전파

- `clearFirestoreAllData`의 `catch`를 제거하고 실패를 호출자(`storage.ts:2023-2026`)로 전달한다.
- 실패 시 “일부 데이터가 삭제되지 않았습니다. 다시 시도해 주세요.”를 표시하고 로컬 캐시는 지우지 않는다. 재시도하면 남은 문서만 삭제된다.

## 4. 요구사항 — 2단계 (P2)

### R5. Firestore IndexedDB 캐시와 메모리 스토어

- `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`로 전환한다. 오프라인 쓰기 보존과 지연 보상(latency compensation)을 SDK에 맡긴다.
- 자체 아웃박스는 조건부(revision) 연산처럼 SDK 트랜잭션이 필요한 경우만 남긴다. 트랜잭션은 오프라인에서 실행되지 않으므로 이 큐는 유지한다.
- 화면 상태는 `localStorage` 파싱 대신 컬렉션별 메모리 스토어(React context 또는 Zustand)에서 읽는다. 스냅샷의 `docChanges()`로 변경분만 반영한다.
- 이 작업은 [T8](./PRD-T8-client-refactor-performance.md)의 `storage.ts` 분할과 함께 진행한다.

## 5. 수용 기준

- [x] `localStorage`가 가득 찬 상태에서 거래를 추가하면 배너가 뜨고 거래는 Firestore에 저장된다. (`firestoreSync.resilience.test.ts`로 용량 한도를 흉내 내 확인: 아웃박스를 못 써도 Firestore로 직접 전송하고 `storageFull`을 보고한다. 실제 브라우저에서 저장소를 채워 보지는 않았다)
- [x] 영수증이 있는 거래 100건을 동기화해도 로컬 거래 캐시에 `rawText`가 없다. (테스트로 확인)
- [x] R3 재현 테스트가 자동화돼 있고 통과한다. (오프라인 큐의 거래가 첫 스냅샷에 가려지는 문제는 **실제로 재현됐다**: 겹쳐 얹는 로직을 끄면 두 테스트가 실패한다)
- [x] 전체 초기화가 중간에 실패하면 실패 안내가 나오고 로컬 데이터가 남는다. (`clearFirestoreAllData`가 오류를 던지는 것은 테스트로, 화면 안내와 로컬 보존은 코드로만 확인했다)
- [ ] (2단계) 거래 5,000건 기준 메인 스레드 작업 50ms 미만. (대기)

## 6. 1단계 구현 메모와 PRD와 다른 점

- `utils/safeStorage.ts`: `safeSetItem`은 저장 실패 시 재생성 가능한 캐시(AI 리포트 캐시, 진단 오류 기록, 라이브 창보다 오래된 거래 캐시)를 비우고 한 번 재시도한다. 그래도 실패하면 `syncStatus.storageFull`을 켜고, 같은 키가 다시 저장되면 끈다. `storage.ts`의 `localStorage.setItem` 59곳과 `firestoreSync.ts`를 모두 교체했다. 일부 화면 설정용 `localStorage` 호출(작은 UI 설정)은 그대로 뒀다.
- 아웃박스 쓰기는 `strictSetItem`으로 예외를 던진다. PRD는 "호출자에게 예외 전달"이었지만 호출자 대부분이 반환값을 쓰지 않아 예외가 처리되지 않은 거부가 된다. 대신 큐에 못 넣은 변경을 **Firestore로 직접 전송**하고, 그것마저 실패하면 `false`와 오류 상태를 돌려준다.
- 배너는 항상 보이는 `StorageFullBanner`(앱 상단)와 저장 상태 패널 두 곳에 표시한다.
- R2: **`rawText`만** 캐시에서 제외했다. `lineItems`는 영수증 검색과 CSV 내보내기가 쓰고 크기도 작아(최대 50건) 유지했다. 제외한 사본에는 `rawTextOmitted` 표시를 붙이며, 이 거래를 수정해 다시 쓸 때는 `merge`로 보내 Firestore의 원문이 지워지지 않게 한다. 영수증 상세 화면은 원문만 Firestore에서 따로 읽는다. 이 때문에 영수증 **원문 텍스트로 하는 검색**은 더 이상 되지 않는다(품목명 검색은 그대로).
- R2: 진단 화면에 키별 저장 공간 사용량(KB) 표시를 추가했고 진단 내보내기에도 포함했다.
- **R2의 `recurringOccurrences` 기간 제한은 구현하지 않았다.** 이 컬렉션은 과거 기록·카드 정산·마감 보고서 등 여러 화면이 전체를 읽는다. 기간 창을 두려면 거래의 `loadTransactionHistoryFrom`과 같은 온디맨드 조회와 모든 사용처 점검이 필요해 별도 작업(2단계의 메모리 스토어와 함께)으로 남긴다.
- R3: 스냅샷 반영 때 아웃박스의 `set`/`delete`/`conditional` 항목을 결과 위에 겹쳐 얹는다(`utils/outboxOverlay.ts`). 영구 실패해 아웃박스에 남은 항목도 계속 겹쳐 보이는데, 저장 상태 패널에 미반영으로 표시되므로 의도한 동작이다.
- R4: `clearFirestoreAllData`는 오류를 던진다. `resetAllData`는 실패하면 로컬 캐시를 지우지 않고 동기화를 다시 시작한 뒤 `ResetIncompleteError`를 던지며, 관리 화면이 "일부 데이터가 삭제되지 않았습니다. 다시 시도해 주세요."를 표시한다.
