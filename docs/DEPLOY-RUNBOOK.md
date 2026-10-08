# 배포 운영 절차 (AI 에이전트용)

Claude, Codex, Gemini 등 어떤 AI 에이전트든 이 문서만 보고 변경을 운영에 배포하고 결과를 확인할 수 있도록 정리했다. 처음 한 번만 하는 Google Cloud 설정은 [AUTO-DEPLOY-SETUP.md](./AUTO-DEPLOY-SETUP.md), 데이터 이관·보안 규칙 배포 순서는 [DEPLOYMENT.md](./DEPLOYMENT.md)에 있다. 작업 규칙은 루트의 [AGENTS.md](../AGENTS.md)를 따른다.

## 1. 핵심 사실

- **main에 push하면 곧 운영 배포다.** 사용자의 명시적 승인 없이 push하지 않는다. 승인은 변경마다 따로 받는다.
- 브랜치를 만들지 않고 main에 직접 커밋한다(사용자 요청).
- 운영: Google Cloud 프로젝트 `gen-lang-client-0746071282`, Cloud Run 서비스 `service`, 리전 `asia-east1`.
  - 주소 `https://iii5412.ai.studio` (AI Studio 도메인), `https://service-dgvep7yheq-de.a.run.app`
- **AI Studio의 배포 버튼은 쓰지 않는다.** AI Studio 안의 예전 코드로 운영을 덮어쓴다. 서비스는 이미 이미지 배포 방식으로 바뀌었다.
- 운영 비밀값(PIN hash, 세션 키, API 키)은 Cloud Run 서비스 환경변수에만 있다. AI Studio의 Secrets 화면은 더 이상 운영에 반영되지 않는다. 비밀값을 코드, 문서, 커밋, 채팅에 넣지 않는다. 저장소는 공개 저장소다.

## 2. 흐름

```
커밋 → git push origin main
  → CI (.github/workflows/ci.yml): 타입 체크, ESLint, 단위 테스트, 보안 규칙 테스트, 빌드
  → Deploy app (.github/workflows/deploy.yml): CI 성공 시 자동 실행
      1. 타입 체크·단위 테스트 재확인
      2. 웹 + 서버 빌드, Android 화면 묶음(live-update/) 빌드
      3. Docker 이미지 → Artifact Registry (asia-east1-docker.pkg.dev/.../expendbreak/server:<commit 12자리>)
      4. 새 리비전을 트래픽 없이 배포, 태그 candidate
      5. https://candidate---service-dgvep7yheq-de.a.run.app 에서 /api/live-update 버전, /, /api/auth/status 확인
      6. 통과하면 트래픽 100%를 새 리비전으로 전환
  → Deploy security rules (.github/workflows/deploy-rules.yml): firestore.rules, storage.rules가 바뀐 경우에만
```

5단계에서 실패하면 트래픽은 이전 리비전에 그대로 있다. 즉 배포 실패가 운영 장애로 이어지지 않는다.

GitHub 저장소 변수(Settings → Variables): `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `VITE_API_BASE_URL`. 키 파일 없이 Workload Identity Federation으로 인증한다.

## 3. 배포 절차

### 3-1. push 전 (로컬)

```bash
npm run lint          # 타입 체크
npx eslint src        # error 0개여야 한다 (warning은 기존부터 있음)
npm test              # 단위 테스트 전부 통과
```

- `npm run test:rules`는 Java 21과 Firebase 에뮬레이터가 필요하다. 로컬에서 못 돌리면 CI에 맡긴다.
- `git status`로 의도한 파일만 커밋되는지 본다. 다른 세션이 작업 중인 미커밋 파일이 섞일 수 있다.
- Android 네이티브(`android/`, Capacitor 플러그인, `capacitor.config.ts`)를 바꿨다면 5장을 먼저 읽는다.

### 3-2. push와 확인

```bash
git push origin main

# CI 결과 기다리기
gh run list -L 3
gh run watch <CI run id> --exit-status

# CI 성공 후 Deploy app이 workflow_run으로 시작된다 (보통 20초 안)
gh run list -w "Deploy app" -L 1
gh run watch <Deploy run id> --exit-status

# 실패 원인 보기
gh run view <run id> --log-failed
```

CI 약 2분, Deploy app 약 3분 걸린다.

### 3-3. 운영 확인

```bash
# 새 화면 묶음 버전 = 배포한 commit 앞 12자리여야 한다
curl -s https://iii5412.ai.studio/api/live-update
curl -s -o /dev/null -w "%{http_code}\n" https://iii5412.ai.studio/
curl -s https://iii5412.ai.studio/api/auth/status
```

- `/healthz`는 외부에서 쓸 수 없다. Cloud Run이 z로 끝나는 일부 경로를 막는다. 대신 `/api/live-update`를 쓴다.
- 로그인이 필요한 기능은 AI가 직접 확인할 수 없다(PIN 필요, 운영 데이터). 사용자에게 폰에서 확인할 항목을 구체적으로 알려준다.

## 4. 앱 화면 자동 업데이트 (OTA)

- Android 1.6.0(versionCode 13)부터 앱이 `/api/live-update`에서 새 화면 묶음을 받는다. 구현은 `src/utils/liveUpdate.ts`, `src/server/routes/liveUpdate.ts`, `scripts/build-live-bundle.mjs`.
- 사용자에게 안내할 것: **배포 후 앱을 한 번 껐다 켜면 받고, 한 번 더 껐다 켜면 적용된다.** 사용 중에는 화면을 바꾸지 않는다.
- 새 화면이 10초 안에 정상 시작을 알리지 않으면 이전 화면으로 돌아가고, 그 버전은 다시 받지 않는다.
- 화면 묶음은 빌드 당시 `android/app/build.gradle`의 `versionCode` 이상인 APK에서만 적용된다.
- 웹(`iii5412.ai.studio`)은 새로고침하면 바로 바뀐다.

## 5. Android 네이티브 변경 (APK 재설치 필요)

해당 변경: `android/` 아래 코드, Capacitor 플러그인 추가·변경, `capacitor.config.ts`.

1. 같은 커밋에서 `android/app/build.gradle`의 `versionCode`를 1 올리고 `versionName`도 올린다.
2. 플러그인을 바꿨다면 `npx cap update android`로 `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`을 갱신해 함께 커밋한다.
3. 배포 후 APK를 만들어 사용자에게 전달한다.
   - **사용자는 debug 서명 APK를 쓴다.** release 서명 키는 없다. 서명이 바뀌면 기존 앱 위에 설치되지 않으므로 반드시 `~/.android/debug.keystore`로 서명되는 debug 빌드를 만든다.
   - 다른 세션의 미커밋 변경이 섞이지 않게, 배포한 커밋을 별도 git worktree에 받아 빌드한다. worktree 안 `node_modules`는 심볼릭 링크·junction 대신 `npm ci`로 설치한다. junction을 둔 채 worktree를 지우면 원본 `node_modules`까지 지워진다.
   - 경로가 길면 Windows에서 삭제가 실패한다. worktree는 짧은 경로에 만들고 `cmd /c rmdir /s /q "\\?\<경로>"`로 지운다.

```bash
git worktree add --detach C:/Users/iii54/Downloads/eb-apkbuild <commit>
cp android/local.properties C:/Users/iii54/Downloads/eb-apkbuild/android/
cd C:/Users/iii54/Downloads/eb-apkbuild
npm ci
LIVE_BUNDLE_VERSION=<commit 앞 12자리> VITE_API_BASE_URL=https://iii5412.ai.studio node scripts/prepare-android.mjs
cd android
JAVA_HOME=<저장소>/.jdk21/<jdk 폴더> ./gradlew.bat assembleDebug
# 결과: android/app/build/outputs/apk/debug/app-debug.apk
# 원본 저장소 artifacts/expendbreak-v<versionName>-<versionCode>-<commit7>-debug.apk 로 복사
```

`LIVE_BUNDLE_VERSION`을 배포 버전과 같게 하면 설치 직후 같은 화면을 다시 내려받지 않는다.

## 6. 실패했을 때

| 증상 | 원인과 조치 |
|---|---|
| CI 실패 | `gh run view <id> --log-failed`. 고쳐서 다시 커밋·push. 운영은 영향 없음 |
| Deploy app의 Build and push image 실패 | Dockerfile 또는 `npm ci --omit=dev` 문제. `.npmrc`(legacy-peer-deps)가 이미지에 들어가야 한다 |
| Deploy without traffic 실패 | Cloud Run 설정 문제. 로그의 `ERROR: (gcloud...)` 줄을 읽는다. 운영은 이전 리비전 유지 |
| Check the new revision 실패 | 새 서버가 시작되지 않음(환경변수 누락 등). 트래픽은 넘어가지 않았다 |
| 배포 후 운영에서 문제 발견 | Cloud Run 콘솔 → service → 버전(Revisions) → 이전 리비전에 트래픽 100%. 또는 `gcloud run services update-traffic service --region asia-east1 --to-revisions <이전 리비전>=100` 후 원인 커밋을 revert |
| 앱에서 "Failed to fetch" | 응답이 앱에 닿지 않음. 요청 크기 한도(`src/server/httpSecurity.ts`의 경로별 한도), 네트워크, 서버 오류 순으로 본다 |

배포 작업용 계정(`github-deployer`)에는 로그 열람 권한이 없다. 운영 로그는 사용자가 Cloud Console의 Logging에서 `jsonPayload.requestId="<X-Request-Id>"`로 찾는다.

## 7. 환경변수 바꾸기

배포 작업은 환경변수를 건드리지 않는다. 바꿀 때는 사용자가 Cloud Shell에서 실행한다(값을 채팅으로 받지 않는다).

```bash
gcloud run services update service --region asia-east1 --project gen-lang-client-0746071282 --update-env-vars NAME=value
gcloud run services update service --region asia-east1 --project gen-lang-client-0746071282 --remove-env-vars NAME
```

이름 목록만 확인할 때(값은 출력하지 않음):

```bash
gcloud run services describe service --region asia-east1 --project gen-lang-client-0746071282 --format=json | jq -r '.spec.template.spec.containers[0].env[].name'
```

## 8. 사용자에게 보고할 것

- 배포 성공 여부와 운영 버전(commit 12자리)
- 직접 확인한 것과 확인하지 못한 것(로그인 필요한 기능은 대부분 확인 불가)
- 폰에서 확인할 구체적인 항목과 "두 번 껐다 켜기" 안내
- APK 재설치가 필요한지 여부
