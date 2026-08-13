# ExpendBreak Android APK·홈 화면 위젯 PRD

작성일: 2026-08-13
대상 기준: `main` (`315bf1b`)
선행 문서: `PRD-production-hardening.md`, `PRD-usability-improvements.md`, `PRD-payday-cashflow-model.md`, `IMPLEMENTATION-STATUS.md`

## 1. 문서 요약

현재 ExpendBreak는 React/Vite 기반 웹앱이며 PWA 설치, 앱 셸 오프라인 캐시, 모바일 레이아웃을 이미 제공한다. 하지만 사용자가 원하는 것은 브라우저의 “홈 화면에 추가”가 아니라 다음 두 가지다.

1. 휴대폰에 독립 앱으로 설치되는 **서명된 Android APK**
2. 앱을 열지 않아도 오늘의 지출 가능 금액을 확인하는 **Android 홈 화면 위젯**

순수 PWA는 Android 네이티브 홈 화면 위젯을 제공할 수 없다. 따라서 기존 React 화면과 계산 로직은 유지하고, **Capacitor 기반 Android 컨테이너 + Kotlin/Jetpack Glance 위젯**을 추가한다.

1차 배포는 한 명의 소유자가 직접 설치하는 서명 APK를 목표로 한다. Google Play 공개 출시는 범위에서 제외하되, 이후 AAB/내부 테스트 트랙으로 옮길 수 있는 구조를 유지한다.

## 2. 배경과 문제

### 2.1 현재 제공되는 기능

- `manifest.webmanifest`, 192/512/maskable 아이콘, `display: standalone`
- 빌드 시 생성되는 서비스 워커와 앱 셸 오프라인 부팅
- Android Chrome의 PWA 설치 안내
- PIN 기반 서버 세션과 로그인 이후 Firestore 동기화
- 급여 주기 기준 `livingBudget`, `remainingAllowance`, `dailySafeAllowance` 계산
- 모바일 하단 내비게이션, 거래 입력, 영수증 촬영, 음성 입력

### 2.2 현재 방식의 한계

| 문제 | 영향 |
|---|---|
| PWA 설치는 브라우저가 관리 | APK 파일로 보관·재설치하거나 네이티브 배포 흐름을 사용할 수 없다. |
| PWA는 Android App Widget Provider를 선언할 수 없음 | 홈 화면에 금액 위젯을 제공할 수 없다. |
| 웹 API가 `/api/*` 상대 경로에 고정 | 번들된 Android WebView에서 원격 서버로 요청하려면 API 기준 URL 분리가 필요하다. |
| 로그인 토큰이 `sessionStorage`에만 존재 | 앱 프로세스 종료 후 다시 PIN 로그인이 필요하며 네이티브 백그라운드 위젯이 세션을 재사용할 수 없다. |
| 계산 데이터는 WebView `localStorage`에 존재 | Kotlin 위젯이 직접 읽을 수 없으므로 명시적인 Web→Native 데이터 브리지가 필요하다. |
| 기존 잠금은 민감 로컬 캐시를 정리 | 위젯에 남은 금액이 잠금 이후에도 노출되지 않도록 별도 정책이 필요하다. |

### 2.3 제품 기회

ExpendBreak의 핵심 숫자는 “오늘 안전하게 쓸 수 있는 금액”이다. 이 숫자는 앱을 탐색하기 전에 볼 수 있을 때 가장 가치가 크다. 위젯은 전체 가계부의 축소판이 아니라 다음 행동을 빠르게 결정하는 진입점이어야 한다.

## 3. 목표와 비목표

### 3.1 목표

- 사용자가 서명된 APK를 Android 휴대폰에 직접 설치하고 기존 계정 데이터를 사용할 수 있다.
- APK에서도 현재 웹앱의 주요 기능이 동일하게 동작한다.
- 홈 화면에서 오늘 안전 금액, 남은 생활비, 남은 일수를 확인할 수 있다.
- 위젯의 “지출 추가”를 누르면 앱의 거래 등록 화면으로 바로 이동한다.
- 앱에서 거래·예산·급여 주기 데이터가 바뀌면 위젯이 2초 이내 갱신된다.
- 위젯에 저장하는 데이터와 인증정보를 최소화하고, 잠금·만료·오류 상태를 명확히 표시한다.
- 기존 웹/PWA 배포를 중단하거나 기능을 퇴행시키지 않는다.

### 3.2 비목표

- iOS 앱 및 iOS 위젯
- Google Play 공개 출시, 결제, 스토어 심사 대응
- 위젯 안에서 거래를 직접 저장하는 기능
- 은행·카드사 자동 연동
- 위젯의 독립적인 전체 Firestore 동기화
- 네이티브 화면으로 전체 앱 재작성
- APK 자동 업데이트 서버
- PIN을 대체하는 생체 인증 또는 오프라인 인증

## 4. 대상 사용자와 핵심 시나리오

### 4.1 대상 사용자

- ExpendBreak를 본인만 사용하는 1인 소유자
- Android 휴대폰을 매일 사용하며 지출 직전 남은 예산을 빠르게 확인하려는 사용자
- 앱스토어 공개 배포보다 개인 기기에 안전하게 설치하는 것을 우선하는 사용자

### 4.2 핵심 시나리오

#### 시나리오 A — 최초 설치

1. 사용자가 서명된 `expendbreak-v{version}.apk`를 휴대폰으로 받는다.
2. Android의 해당 출처 설치 허용 절차를 거쳐 APK를 설치한다.
3. 앱을 열고 기존 PIN으로 로그인한다.
4. 앱이 서버와 Firestore에서 기존 데이터를 불러온다.
5. 설정의 “홈 화면 위젯 추가”에서 위젯 고정 요청을 실행한다.

#### 시나리오 B — 지출 직전 확인

1. 사용자가 홈 화면의 2×2 위젯을 본다.
2. “오늘 안전 35,000원”, “남은 생활비 1,020,000원 · 29일”을 확인한다.
3. 위젯을 누르면 앱의 홈 대시보드가 열린다.

#### 시나리오 C — 빠른 지출 입력

1. 사용자가 4×2 위젯의 “+ 지출”을 누른다.
2. 앱이 열리고 잠겨 있으면 PIN 화면이 먼저 표시된다.
3. 잠금 해제 뒤 거래 등록 모달이 자동으로 열린다.
4. 거래 저장 직후 위젯 금액이 갱신된다.

#### 시나리오 D — 민감정보 보호

1. 앱이 유휴 잠금되거나 사용자가 잠금 버튼을 누른다.
2. 기본 개인정보 모드에서는 위젯 금액이 “잠금 해제 후 확인”으로 바뀐다.
3. 위젯을 누르면 앱의 PIN 화면으로 이동한다.

## 5. 제품 결정

### 5.1 네이티브 컨테이너: Capacitor

기존 React/Vite 앱에 Capacitor Android 플랫폼을 추가한다.

선택 이유:

- 기존 웹 화면과 TypeScript 계산 로직을 그대로 재사용할 수 있다.
- APK 안에 `dist` 자산을 번들하여 웹 서버 장애와 무관하게 앱 UI를 부팅할 수 있다.
- Kotlin 네이티브 플러그인을 통해 위젯 데이터 저장, 위젯 갱신, 딥링크를 구현할 수 있다.
- 카메라·마이크·상태바·뒤로 가기 등 Android 동작을 단계적으로 네이티브화할 수 있다.

대안과 제외 이유:

| 대안 | 제외 이유 |
|---|---|
| PWA만 유지 | APK 및 네이티브 위젯 제공 불가 |
| TWA/Bubblewrap | 웹 배포 의존성이 크고 위젯을 위해 결국 별도 네이티브 모듈이 필요 |
| React Native 전체 재작성 | 현재 기능·테스트 재사용성이 낮고 초기 범위가 지나치게 큼 |
| 원격 URL을 여는 단순 WebView | 오프라인 부팅과 버전 일관성이 약하며 배포된 웹 변경이 APK 검증 없이 반영됨 |

### 5.2 위젯: Kotlin + Jetpack Glance

위젯은 WebView가 아니라 Android `AppWidgetProvider`로 제공한다. UI는 Jetpack Glance로 구현하되, Glance가 일반 Compose UI와 동일하지 않고 App Widget/RemoteViews 제약을 따른다는 전제로 단순한 정보형·실행형 위젯만 제공한다.

### 5.3 배포: 1차 서명 APK, 이후 선택적 AAB

- 1차: 소유자에게 release 서명 APK 직접 전달
- 업데이트: 동일 서명키 + 증가한 `versionCode`로 새 APK를 덮어 설치
- 선택적 후속: Google Play 내부 테스트 또는 비공개 테스트용 AAB
- 디버그 APK는 실사용 데이터에 연결하지 않는다.

## 6. 정보 구조와 화면 요구사항

### 6.1 Android 앱

웹앱의 정보 구조를 그대로 유지한다.

- 홈
- 내역
- 작성
- 분석
- 더보기/설정

Android 전용 설정 영역을 추가한다.

```
설정
└─ Android 앱
   ├─ 설치 버전
   ├─ 위젯 추가
   ├─ 위젯 개인정보 보호
   ├─ 위젯 데이터 새로고침
   └─ 앱 빌드 정보
```

### 6.2 2×2 위젯 — 오늘 안전 금액

필수 표시:

- 앱 이름 또는 브레이크 아이콘
- `오늘 안전`
- `dailySafeAllowance` 큰 숫자
- `remainingAllowance`와 `daysRemaining`
- 마지막 갱신 상태 아이콘

동작:

- 본문 탭 → 앱 홈 대시보드
- 잠김/만료 상태 탭 → 앱 PIN 화면
- 크기 조절 시 2×1 이하에서는 안전 금액과 상태만 유지

### 6.3 4×2 위젯 — 생활비 브레이크

필수 표시:

- 오늘 안전 금액
- 남은 생활비
- 사용률 또는 위험 상태(`safe`, `caution`, `warning`, `danger`)
- 남은 일수
- 마지막 갱신 시각
- “+ 지출” 액션
- 새로고침 액션

동작:

- “+ 지출” → 거래 등록 딥링크
- 본문 → 홈 대시보드 딥링크
- 새로고침 → 로컬 스냅샷으로 일수·오늘 안전 금액 재계산 후 렌더링

### 6.4 위젯 상태

| 상태 | 표시 | 사용자 행동 |
|---|---|---|
| `no_data` | “앱을 열어 설정해 주세요” | 앱 열기 |
| `locked` | “잠금 해제 후 확인” | PIN 화면 열기 |
| `ready` | 금액과 상태 정상 표시 | 홈/거래 추가 이동 |
| `stale` | 마지막 값 + “앱에서 갱신 필요” | 앱 열기 |
| `offline` | 마지막 값 + 오프라인 표시 | 앱 열기 또는 유지 |
| `error` | “정보를 표시할 수 없음” | 앱 열기 |

`stale`은 마지막 Web→Native 동기화 후 24시간이 지났거나 스냅샷 스키마가 호환되지 않을 때 적용한다. 오래된 숫자를 최신 숫자처럼 보이지 않게 한다.

## 7. 기능 요구사항

### 7.1 APK 셸

#### APK-01 빌드 구조

- `webDir`은 Vite의 `dist`를 사용한다.
- Android release 빌드는 반드시 `npm run build` 성공 후 `cap sync android`를 수행한다.
- 번들에는 소스맵, `.env`, 서버 자격증명, PIN hash, 서명키를 포함하지 않는다.
- 네이티브 빌드에는 `applicationId`, `versionCode`, `versionName`을 명시한다.
- 권장 application ID는 `com.iii5412.expendbreak`로 한다. 실제 생성 전 중복 여부를 확정한다.

#### APK-02 API 기준 URL 분리

- 브라우저/PWA는 기존처럼 동일 출처 `/api`를 사용한다.
- Android는 빌드 환경의 `VITE_API_BASE_URL`을 사용한다.
- `authenticatedFetch`, PIN 로그인, 인증 상태 확인 등 모든 API 호출은 공통 `apiUrl(path)`를 거친다.
- 운영 API는 HTTPS만 허용하고 Android cleartext traffic은 비활성화한다.
- 서버는 정확한 Android WebView origin만 CORS 허용하고 `Authorization`, `Content-Type` 헤더를 허용한다.
- Firebase Storage 업로드/다운로드와 WebRTC 음성 기능은 실제 Android WebView origin에서 별도 검증한다.

#### APK-03 웹/PWA와 네이티브 분기

- `Capacitor.isNativePlatform()` 기반 런타임 어댑터를 둔다.
- Android 앱에서는 `InstallAppCard`와 서비스 워커 등록 UI를 숨긴다.
- 웹/PWA에서는 현재 설치와 서비스 워커 업데이트 동작을 유지한다.
- Android는 번들 자산을 사용하며 원격 `server.url`을 운영 설정으로 사용하지 않는다.

#### APK-04 Android 시스템 동작

- 상태바와 내비게이션 바가 기존 slate 테마와 일치한다.
- 디스플레이 컷아웃과 시스템 바 inset 때문에 버튼이 가려지지 않는다.
- Android 뒤로 가기는 다음 우선순위를 따른다.
  1. 열린 모달/시트 닫기
  2. 하위 화면에서 이전 화면으로 이동
  3. 홈에서 앱을 백그라운드로 이동
- 카메라·마이크 권한은 해당 기능을 처음 사용할 때만 요청한다.
- 권한 거부 시 웹 오류가 아니라 설정 이동을 포함한 한국어 안내를 표시한다.
- 외부 링크는 시스템 브라우저로 연다.

#### APK-05 잠금과 세션

- 최초 설치와 콜드 스타트에서는 기존 PIN 로그인을 요구한다.
- PIN 원문은 WebView 저장소, 네이티브 저장소, 로그에 남기지 않는다.
- 1차 버전에서는 백그라운드 위젯 갱신을 위해 로그인 토큰을 영구 저장하지 않는다.
- 앱 잠금/로그아웃 이벤트를 네이티브 브리지에 전달해 위젯을 즉시 `locked`로 전환한다.
- 앱 프로세스가 강제 종료돼 잠금 이벤트를 전달하지 못한 경우를 대비해 스냅샷에 `visibleUntil`을 저장한다.

#### APK-06 데이터 연속성

- APK의 WebView 저장소는 Chrome PWA 저장소와 공유되지 않는다는 안내를 최초 실행 시 표시한다.
- 신규 APK 설치 후 온라인 PIN 로그인과 Firestore hydrate가 완료돼야 데이터를 표시한다.
- 앱 제거 시 로컬 데이터는 삭제될 수 있으므로 Firestore 동기화 상태와 미반영 outbox를 설정에서 확인할 수 있어야 한다.
- APK 업데이트 설치는 동일 서명키와 application ID를 사용하여 앱 데이터와 위젯 배치를 유지한다.

### 7.2 위젯 데이터 브리지

#### WDG-01 단방향 스냅샷

React 앱은 계산 완료 후 Kotlin 플러그인 `WidgetBridge.publishSnapshot()`에 최소 요약만 전달한다.

```ts
interface WidgetSnapshotV1 {
  schemaVersion: 1;
  periodYM: string;
  periodEndDate: string;
  remainingAllowance: number;
  confirmedVariableExpenses: number;
  spendableLimit: number;
  dailySafeAllowance: number;
  daysRemaining: number;
  alertLevel: 'safe' | 'caution' | 'warning' | 'danger';
  calculatedAt: string;
  visibleUntil: string | null;
  privacyMode: 'unlock_required' | 'always_show' | 'amounts_hidden';
}
```

다음 데이터는 위젯 스냅샷에 넣지 않는다.

- PIN, 로그인/Authorization 토큰
- 계좌번호, 카드번호, 카드사 식별정보
- 거래 목록, 상호명, 메모, 영수증
- 사용자 UID, 이메일 등 개인 식별정보

#### WDG-02 저장 보안

- 스냅샷은 앱 전용 네이티브 저장소에 저장한다.
- 암호화 키는 Android Keystore에서 생성하고 반출 불가능하게 관리한다.
- 저장값은 AES-GCM 등 인증 암호화 방식으로 보호한다.
- Android 백업 대상에서 위젯 스냅샷과 인증 관련 저장소를 제외한다.
- 복호화 실패 또는 스키마 불일치는 값을 폐기하고 `no_data`로 전환한다.

#### WDG-03 갱신 트리거

아래 이벤트에서 전체 위젯 인스턴스를 갱신한다.

- 로그인 후 첫 데이터 계산 완료
- 거래 생성·수정·삭제·복원
- 정기 항목 확정·취소·수정
- 예산, 급여 주기, 카드대금, 주기 기준선 변경
- Firestore 실시간 스냅샷 반영
- 앱 잠금·로그아웃
- 개인정보 모드 변경
- 위젯의 수동 새로고침
- Android의 주기적 위젯 업데이트 시점

Web→Native 스냅샷 발행은 같은 값의 연속 호출을 해시로 중복 제거한다.

#### WDG-04 날짜 경계 재계산

- 네이티브 위젯은 `remainingAllowance`와 `periodEndDate`를 이용해 날짜가 바뀌면 `daysRemaining`과 `dailySafeAllowance`를 다시 계산한다.
- 식은 웹의 계산 규칙과 동일하게 `max(0, floor(remainingAllowance / max(1, daysRemaining)))`을 사용한다.
- Android 위젯의 기본 주기 업데이트는 시스템 허용 범위인 30분 이상으로 설정한다.
- 백그라운드 실행이 지연될 수 있으므로 마지막 갱신 시각을 항상 표시하고 수동 새로고침을 제공한다.
- 원격 거래 변경은 앱이 다음에 열리거나 포그라운드 동기화될 때 반영한다. 1차 버전에서 위젯이 Firestore를 직접 조회하지 않는다.

### 7.3 개인정보 보호 설정

#### WDG-05 개인정보 모드

| 모드 | 동작 |
|---|---|
| 잠금 연동(기본) | 앱이 잠겨 있거나 `visibleUntil`이 지나면 모든 금액을 숨김 |
| 항상 표시 | 명시적 경고와 사용자 확인 후 잠금 상태에서도 요약 금액 표시 |
| 금액 숨김 | 위험 상태와 “앱에서 확인”만 표시 |

- 기본값은 `unlock_required`다.
- “항상 표시” 선택 시 홈 화면을 볼 수 있는 사람에게 금액이 노출된다는 경고를 표시한다.
- 앱의 유휴 잠금 시간이 바뀌면 `visibleUntil`도 같은 정책으로 갱신한다.
- 최근 앱 화면에서는 금융 정보가 보이지 않도록 Android task preview를 마스킹한다.

### 7.4 딥링크

#### WDG-06 목적지

| URI | 목적지 |
|---|---|
| `expendbreak://home` | 홈 대시보드 |
| `expendbreak://transaction/new` | 거래 등록 모달 |
| `expendbreak://settings/widget` | Android 위젯 설정 |

- 앱이 잠겨 있으면 목적지를 메모리에 보관하고 PIN 성공 후 한 번만 실행한다.
- 유효하지 않은 URI는 홈으로 이동한다.
- 딥링크 인자만으로 거래를 생성·수정·삭제하지 않는다.
- `PendingIntent`는 변경 불가능 플래그를 기본 사용하고 목적지별 고유 request code를 사용한다.

### 7.5 앱 내 위젯 추가

#### WDG-07 위젯 고정 요청

- 설정의 “홈 화면 위젯 추가” 버튼은 Android 8 이상에서 시스템 위젯 고정 요청을 실행한다.
- 런처가 고정 요청을 지원하지 않으면 “홈 화면 길게 누르기 → 위젯 → 지출브레이크” 절차를 안내한다.
- 위젯 미리보기는 실제 다크 테마와 개인정보 모드 상태를 반영한 예시를 제공한다.

## 8. 비기능 요구사항

### 8.1 성능

- 중급 Android 기기 기준 콜드 스타트 후 잠금 화면 표시: 2.5초 이내
- 웜 스타트: 1초 이내
- React 데이터 변경 후 위젯 렌더 반영: 2초 이내
- 위젯 렌더/갱신은 메인 스레드에서 네트워크·대용량 JSON 파싱을 수행하지 않는다.
- release APK 용량은 초기 목표 35MB 이하로 하되, 기능 정확성을 위해 조정할 수 있다.

### 8.2 안정성

- 오프라인이어도 APK 셸과 마지막 위젯 상태가 렌더링된다.
- API 또는 Firestore 오류가 앱 크래시로 이어지지 않는다.
- 위젯 저장값 손상, 앱 업데이트 중 스키마 변경, 시스템 재부팅을 복구한다.
- Android가 앱 프로세스를 종료해도 위젯 탭과 앱 재실행이 동작한다.

### 8.3 접근성

- 위젯의 텍스트 대비는 WCAG AA 수준을 목표로 한다.
- 금액은 글자 크기 확대 시 잘리지 않고 우선순위가 낮은 보조 문구부터 숨긴다.
- 색상만으로 위험 상태를 표현하지 않고 텍스트/아이콘을 함께 사용한다.
- 터치 액션에는 Android 접근성 설명을 제공한다.

### 8.4 호환성

- 최소 지원: Android 8.0(API 26)
- 필수 실기기 검증: Samsung Galaxy/One UI 1종, Google Pixel 계열 1종
- Android 12 이상의 반응형 위젯 크기와 테마 동작을 우선 최적화한다.
- 화면 비율, 다크 모드, 글꼴 100%/130%/200%를 검증한다.

## 9. 보안 요구사항과 출시 게이트

### 9.1 필수 보안 요구사항

- 운영 API는 HTTPS만 사용한다.
- release 빌드는 `debuggable=false`이며 WebView 디버깅을 비활성화한다.
- PIN, 세션 secret, Firebase Admin 자격증명, OpenAI/Gemini 키를 APK에 포함하지 않는다.
- API 로그에 PIN, bearer token, 전체 금융 스냅샷을 남기지 않는다.
- 서명 keystore와 비밀번호는 저장소 밖에서 보관하고 별도 백업한다.
- 동일한 release 서명키를 앱 수명 동안 유지한다.
- Firebase/Storage rules가 실제 운영 환경에서 소유자 외 접근을 거부하는지 검증한다.
- Android origin의 CORS는 와일드카드(`*`)를 사용하지 않는다.
- `android:allowBackup` 또는 data extraction rules로 민감 저장소 백업을 차단한다.

### 9.2 현재 코드에서 APK 착수 전 확인할 항목

- 문서상 “Firebase custom token 인증”과 실제 클라이언트 인증 흐름이 일치하는지 운영 환경에서 확인한다.
- `firestore.rules`의 소유자 판정이 인증 없는 접근을 허용하지 않는지 emulator와 운영 프로젝트에서 검증한다.
- PIN 세션 토큰의 발급·만료·폐기 정책을 Android 콜드 스타트 정책과 맞춘다.
- 원격 API 기준 URL과 Android origin에서 영수증·음성·AI 요청이 정상 동작하는지 확인한다.

위 항목은 APK가 웹보다 더 많은 데이터를 노출해서가 아니라, 설치 앱이 장기간 유지되고 위젯이 잠금 화면 밖에 존재하므로 출시 전에 반드시 닫아야 하는 보안 게이트다.

## 10. 배포와 업데이트

### 10.1 개인용 직접 설치

릴리스 산출물:

- `expendbreak-v{versionName}-{versionCode}.apk`
- SHA-256 체크섬
- 변경 내역
- 설치/업데이트 안내

설치 절차:

1. APK와 체크섬을 신뢰할 수 있는 경로로 휴대폰에 전달한다.
2. 사용자가 해당 파일 제공 앱에 대해서만 “알 수 없는 앱 설치”를 일시 허용한다.
3. APK 설치 후 권한을 다시 해제하도록 안내한다.
4. 앱에서 버전과 서명 빌드 유형을 확인한다.

### 10.2 업데이트

- `versionCode`는 모든 release마다 증가한다.
- 동일한 application ID와 release 서명키를 사용한다.
- 업데이트 전 Firestore 동기화 완료 및 outbox 0건을 권장한다.
- 서명키가 다르면 기존 앱 위에 업데이트할 수 없으므로 keystore 분실을 P0 운영 사고로 취급한다.
- 데이터 스키마 변경에는 전진 마이그레이션과 이전 버전 방어 로직을 포함한다.

### 10.3 향후 Play 배포

공개 또는 내부 Play 배포로 전환할 경우 APK가 아니라 AAB를 생성하고 Play App Signing/업로드 키를 분리한다. Play 공개 심사, 개인정보처리방침, 데이터 안전 섹션은 별도 PRD 범위로 둔다.

## 11. 분석 이벤트와 운영 로그

1인용 앱이므로 외부 분석 SDK는 도입하지 않는다. 문제 진단에 필요한 로컬 상태만 제공한다.

- 앱 버전, WebView 버전, Android 버전
- 마지막 위젯 발행/렌더 시각
- 위젯 스냅샷 스키마 버전
- 위젯 상태(`ready`, `locked`, `stale`, `error`)
- 마지막 오류 코드(민감 데이터 제외)

설정의 “진단 정보 복사”는 금액, 거래, 토큰, UID를 제외한다.

## 12. 성공 지표

### 출시 성공 기준

- 소유자 기기에 release APK 설치 성공
- 기존 PIN 로그인 및 Firestore 데이터 hydrate 성공
- 거래 추가/수정/삭제, 영수증, 음성, 분석의 핵심 회귀 시나리오 통과
- 2×2 및 4×2 위젯 추가 성공
- 거래 저장 후 위젯 값 2초 내 갱신
- 잠금 후 위젯 금액 즉시 마스킹
- 앱 업데이트 설치 후 데이터와 위젯 배치 유지
- 7일 실사용 중 크래시·데이터 유실 0건

### 사용자 가치 기준

- 홈 화면에서 앱을 열지 않고 오늘 안전 금액을 3초 안에 확인 가능
- 위젯에서 거래 입력 모달까지 2번 이하의 탭으로 도달
- 위젯 값과 앱 대시보드 값 불일치 0건(동일 `calculatedAt` 기준)

## 13. 단계별 구현 계획

### Phase 0 — 보안·환경 게이트

- 실제 인증/Firebase rules 검증
- 운영 API URL과 Android CORS 정책 확정
- application ID, 최소 Android 버전, release 서명키 확정
- debug/staging/prod 연결 분리

완료 조건: 인증되지 않은 클라이언트가 금융 데이터를 읽거나 쓸 수 없고, staging Android origin에서 전체 로그인 흐름이 통과한다.

### Phase 1 — Android APK 셸

- Capacitor 초기화 및 Android 프로젝트 추가
- API URL 어댑터와 네이티브 환경 분기
- 상태바, inset, 뒤로 가기, 권한, 외부 링크 처리
- 네이티브에서 PWA 설치/서비스 워커 UI 비활성화
- release APK 서명·버전·빌드 스크립트

완료 조건: 실기기에서 로그인, 데이터 조회, 거래 CRUD, 영수증/음성이 회귀 없이 동작한다.

### Phase 2 — 위젯 MVP

- `WidgetSnapshotV1`과 TypeScript 발행 어댑터
- Android Keystore 기반 저장소
- 2×2 Glance 위젯
- `ready/no_data/locked/stale/error` 상태
- 홈/거래 등록 딥링크
- 데이터 변경·잠금 시 즉시 갱신

완료 조건: 앱 값과 위젯 값이 일치하고 잠금 정책이 프로세스 재시작 후에도 유지된다.

### Phase 3 — 위젯 완성도

- 4×2 반응형 위젯
- 앱 내 위젯 고정 요청과 설정 화면
- 개인정보 모드 3종
- 날짜 경계 재계산, 수동 새로고침, 상태/갱신 시각
- One UI/Pixel 런처, 글꼴 확대, 재부팅, 업데이트 검증

완료 조건: §14 인수 기준 전체 통과.

### Phase 4 — 선택적 후속

- 생체 인증 및 기기 결합 오프라인 잠금 해제
- 최소 요약 API를 통한 선택적 백그라운드 원격 갱신
- 로컬 알림(예산 위험, 정기 결제일)
- Play 내부 테스트/AAB 배포

## 14. 인수 기준

### APK

- [ ] 서명된 release APK가 Android 8 이상 실기기에 설치된다.
- [ ] 기존 PWA와 별도 앱 아이콘/패키지로 실행된다.
- [ ] 최초 실행 시 APK와 PWA의 로컬 저장소가 공유되지 않음을 안내한다.
- [ ] 온라인 PIN 로그인 후 기존 데이터가 누락 없이 표시된다.
- [ ] API, Firestore, Storage, 카메라, 마이크 기능이 Android 앱에서 동작한다.
- [ ] Android 뒤로 가기가 모달 → 화면 → 백그라운드 순서로 동작한다.
- [ ] 오프라인에서 앱 셸이 부팅되고 현재 정책에 맞는 잠금/오류 화면을 표시한다.
- [ ] 기존 웹/PWA 빌드와 설치 흐름이 유지된다.

### 위젯

- [ ] 2×2와 4×2 위젯이 런처 선택 목록에 나타난다.
- [ ] 앱에서 위젯 고정 요청을 할 수 있다.
- [ ] `dailySafeAllowance`, `remainingAllowance`, `daysRemaining`, `alertLevel`이 앱과 일치한다.
- [ ] 거래 저장 후 2초 이내 위젯이 갱신된다.
- [ ] 날짜 변경 후 로컬 스냅샷 기준 일수와 안전 금액이 재계산된다.
- [ ] 위젯의 “+ 지출”이 잠금 해제 후 거래 등록 모달을 연다.
- [ ] 잠금 연동 모드에서 잠금·로그아웃·`visibleUntil` 만료 후 금액이 보이지 않는다.
- [ ] 항상 표시 모드는 경고 확인 후에만 활성화된다.
- [ ] 토큰, 거래 목록, 계좌/카드 정보가 네이티브 위젯 저장소에 존재하지 않는다.
- [ ] 스냅샷 손상·스키마 불일치 시 앱이 크래시하지 않고 `no_data`로 복구한다.
- [ ] 재부팅과 APK 업데이트 후 위젯이 정상 동작한다.

### 보안·배포

- [ ] release APK는 디버깅 불가이며 HTTPS만 사용한다.
- [ ] APK 분석 결과 서버 secret, PIN hash, Admin/API 비밀키가 없다.
- [ ] Firestore/Storage 비소유자 접근 거부 테스트가 통과한다.
- [ ] CORS 허용 origin이 명시적 목록으로 제한된다.
- [ ] release keystore가 저장소 밖에 있고 복구 가능한 별도 백업이 있다.
- [ ] APK SHA-256 체크섬과 설치 안내가 함께 제공된다.

## 15. 테스트 계획

### 자동 테스트

- `apiUrl()`의 web/native 환경별 URL 조합
- `WidgetSnapshotV1` 직렬화, 스키마 검증, 범위 검증
- 날짜/시간대별 `daysRemaining`과 `dailySafeAllowance` 재계산
- 잠금 상태와 `visibleUntil` 만료 상태 머신
- 딥링크 파싱과 잠금 후 목적지 재개
- 동일 스냅샷 중복 발행 방지
- 기존 계산·저장·동기화 Vitest 전체 회귀
- Android JVM 테스트: 암복호화 실패, 저장소 손상, 위젯 상태 매핑

### 수동/E2E 테스트

- Android 8, 12/13, 최신 지원 버전
- Samsung One UI 및 Pixel Launcher
- 온라인/오프라인/느린 네트워크 전환
- 프로세스 강제 종료, 기기 재부팅, 날짜·시간대 변경
- 권한 허용/거부/“다시 묻지 않음”
- PIN 성공/실패/요청 제한/세션 만료
- 위젯 추가·크기 조절·삭제·재추가
- 앱 미실행 상태에서 위젯 딥링크
- 같은 서명키 업데이트와 다른 서명키 설치 실패 확인

## 16. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| Android WebView origin에서 상대 API 요청 실패 | 로그인·AI 기능 불가 | API URL 어댑터와 staging 실기기 통합 테스트를 Phase 1 선행 |
| PWA와 APK 저장소가 분리됨 | 사용자가 데이터가 사라졌다고 오해 | 최초 실행 안내 + Firestore hydrate 완료 전 빈 샘플 생성 금지 |
| 위젯이 오래된 값을 표시 | 잘못된 소비 판단 | `calculatedAt`, `stale`, 수동 새로고침, 앱 포그라운드 즉시 동기화 |
| 홈 화면에서 금융 금액 노출 | 프라이버시 침해 | 잠금 연동 기본값, 만료 시 마스킹, 항상 표시 명시적 동의 |
| 네이티브/웹 계산식 분기 | 앱과 위젯 불일치 | 네이티브는 최소 날짜 경계 계산만 수행하고 동일 fixture 테스트 공유 |
| 서명키 분실 | 기존 앱 업데이트 불가 | 저장소 밖 이중 백업과 복구 절차 문서화 |
| Android 제조사별 위젯 지연 | 갱신 시점 편차 | 앱 이벤트 즉시 갱신 + 시스템 주기 갱신 + One UI 실기기 검증 |
| 서버 토큰 영구 저장 유혹 | 탈취 시 장기 세션 악용 | MVP에서 토큰을 네이티브 위젯에 전달하지 않음 |
| 서비스 워커와 번들 자산의 이중 캐시 | 오래된 UI 노출 | 네이티브 환경에서 서비스 워커 미등록, `dist`는 APK 버전으로만 교체 |

## 17. 미결정 사항

구현 착수 전에 소유자가 최종 결정할 항목이다.

1. 실제 Android 휴대폰 모델과 Android 버전
2. 기본 위젯 크기: 2×2 또는 4×2
3. 위젯 기본 개인정보 모드(본 PRD 권장: 잠금 연동)
4. application ID `com.iii5412.expendbreak` 확정 여부
5. 1차 APK 전달 경로와 release keystore 보관 위치
6. 기존 Chrome PWA를 유지할지, APK 설치 후 제거할지
7. 향후 Google Play 내부 테스트 배포 필요 여부

## 18. 기술 근거

- Capacitor는 기존 현대적 웹 프로젝트에 추가할 수 있고 네이티브 SDK를 플러그인으로 연결하는 웹 중심 네이티브 런타임을 제공한다: <https://capacitorjs.com/docs>
- Android App Widget은 `AppWidgetProvider`와 메타데이터를 가진 네이티브 앱 구성요소다: <https://developer.android.com/develop/ui/views/appwidgets>
- Jetpack Glance는 Kotlin API로 Android 위젯을 만들되 일반 Compose UI와 직접 호환되지 않으며 App Widget 제약을 따른다: <https://developer.android.com/develop/ui/compose/glance>
- Android 위젯의 `updatePeriodMillis`는 30분보다 짧은 주기를 지원하지 않으며 긴 작업은 WorkManager 사용이 권장된다: <https://developer.android.com/develop/ui/views/appwidgets/advanced>
- Android 8 이상에서는 앱 안에서 홈 화면 위젯 고정을 요청할 수 있다: <https://developer.android.com/develop/ui/compose/glance/pin-in-app>
- Android Keystore는 키 소재의 추출 방지를 제공한다: <https://developer.android.com/privacy-and-security/keystore>
- Android APK는 설치·업데이트를 위해 디지털 서명이 필요하며 직접 배포도 가능하다: <https://developer.android.com/studio/publish/app-signing>
