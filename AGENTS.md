# 지출브레이크 (expendBreak) — AI 작업 지침

개인·가족 가계부 앱이다. 실제 금융 데이터와 두 계정(소유자, 배우자)이 운영 중이다. Claude, Codex 등 모든 AI 에이전트는 이 문서를 따른다.

## 구조

- 화면: React 19 + Vite + Tailwind (`src/`). 사용자에게 보이는 문구는 한국어.
- 서버: Express (`src/server/`). `src/server/app.ts`가 라우트를 조립하고 `src/server/index.ts`가 실행한다.
- 데이터: Firestore + Firebase Storage. 보안 규칙은 `firestore.rules`, `storage.rules`.
- Android: Capacitor 8 (`android/`). 위젯, SMS 읽기, APK 자체 업데이트는 Kotlin 네이티브 코드다.
- AI: Gemini(`@google/genai`)와 OpenAI. 키는 서버 환경변수에만 있다.

## 배포 흐름 (main에 반영되면 자동)

1. `.github/workflows/ci.yml`: 타입 체크, ESLint, 단위 테스트, 보안 규칙 테스트, 빌드.
2. 통과하면 `.github/workflows/deploy.yml`이 Cloud Run 서비스에 배포한다. 새 버전은 먼저 트래픽 없이 올라가고, 확인을 통과해야 전환된다.
3. 같은 배포에 Android 화면 묶음이 들어 있어, 설치된 앱은 다음 실행 때 새 화면을 받는다(`src/utils/liveUpdate.ts`).
4. `firestore.rules`, `storage.rules` 변경은 `.github/workflows/deploy-rules.yml`이 별도로 배포한다.

그러므로 main에 들어가는 모든 변경은 곧 운영에 나간다.

배포·확인·롤백·APK 빌드 절차는 [docs/DEPLOY-RUNBOOK.md](docs/DEPLOY-RUNBOOK.md)를 따른다. push는 사용자가 승인한 경우에만 한다.

## 반드시 지킬 것

- 작업을 끝내기 전에 `npm run lint`와 `npm test`를 통과시킨다. 서버 라우트나 규칙을 바꾸면 테스트도 추가한다.
- 비밀값(PIN, PIN hash, 세션 키, API 키, 서비스 계정)을 코드, 테스트, 문서, 커밋, PR 설명에 넣지 않는다. 저장소는 공개 저장소다.
- 금액 연산을 거친 문서는 revision 프로토콜을 따른다(`docs/PRD-ui-renewal-2026-09-19.md` §8, `docs/DEPLOYMENT.md` §3-1). 금액, 상태, 연결 거래를 바꾸는 쓰기는 `revision`을 정확히 1 올린다.
- 데이터를 삭제하거나 덮어쓰는 마이그레이션을 만들지 않는다. 기존 데이터 이관은 복사만 한다.
- AI가 만든 거래는 바로 저장하지 않고 사용자가 확인하는 화면을 거친다.
- 계좌번호, 문자 원문, 발신번호는 AI나 외부로 보내지 않는다.
- 보안 규칙 변경과, 그 규칙에 의존하는 앱 변경을 한 PR에 섞지 않는다. 순서는 `docs/DEPLOYMENT.md`를 따른다.

## Android 네이티브를 바꿀 때

`android/` 아래 코드, Capacitor 플러그인 추가·변경, `capacitor.config.ts` 변경은 새 APK가 필요하다.

- 같은 변경에서 `android/app/build.gradle`의 `versionCode`를 1 올리고 `versionName`도 올린다.
- 그러면 화면 묶음이 새 `versionCode` 이상의 APK에서만 적용되어, 예전 APK가 없는 네이티브 기능을 호출하지 않는다.
- PR 설명 맨 위에 "APK 재설치 필요"라고 적는다.

화면(`src/` 중 서버 제외)과 서버만 바꾸는 변경은 `versionCode`를 올리지 않는다. 올리면 새 APK를 설치하기 전까지 화면 업데이트가 멈춘다.

## 명령

```bash
npm run dev          # 개발 서버 (Vite 미들웨어 포함)
npm run lint         # 타입 체크
npm run lint:eslint  # ESLint
npm test             # 단위 테스트
npm run test:rules   # 보안 규칙 테스트 (Firebase 에뮬레이터, Java 21 필요)
npm run build        # 웹 + 서버 번들
```
