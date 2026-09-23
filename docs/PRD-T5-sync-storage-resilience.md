# T5. 로컬 캐시·동기화 복원력 PRD

- 문서 상태: Draft v1.0
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

- [ ] 개발자 도구로 `localStorage`를 가득 채운 상태에서 거래를 추가하면 배너가 뜨고, 거래는 Firestore에 저장된다.
- [ ] 영수증이 있는 거래 100건을 동기화해도 로컬 거래 캐시에 `rawText`가 없다.
- [ ] R3 재현 테스트가 자동화돼 있고 통과한다.
- [ ] 네트워크를 끊고 전체 초기화를 실행하면 실패 안내가 나오고 로컬 데이터가 남아 있다.
- [ ] (2단계) 거래 5,000건 기준 거래 1건 추가 시 메인 스레드 작업이 50ms 미만이다.
