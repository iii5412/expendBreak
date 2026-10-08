# 자동 배포 + 앱 자동 업데이트 설정 가이드

목표: 폰에서 Claude나 Codex에 수정을 요청하고, 그 결과를 승인(merge)하면 서버와 화면이 자동으로 배포되며, 앱을 다시 켜면 새 화면이 적용되게 한다.

비용: 지금 쓰는 Google Cloud 프로젝트(`gen-lang-client-0746071282`)와 Cloud Run 서비스를 그대로 쓰므로 무료 사용량 안에서 동작하는 구조는 같다. 저장소가 공개(Public)라 GitHub Actions 실행 시간도 무료다.

역할 분담:

| 단계 | 하는 사람 | 걸리는 시간 |
|---|---|---|
| 1. Google Cloud 현황 확인 + 예산 알림 | 사용자 | 10분 |
| 2. GitHub과 Google Cloud 연결 | 사용자 (명령 복사·붙여넣기) | 15분 |
| 3. GitHub 저장소에 설정값 등록 | 사용자 또는 Claude | 5분 |
| 4. 배포 설정·앱 자동 업데이트 코드 작성 | Claude | - |
| 5. 마지막 APK 한 번 설치 | 사용자 | 5분 |
| 6. 폰에서 쓰는 AI 연결 | 사용자 | 10분 |
| 7. 처음부터 끝까지 시험 | 함께 | 10분 |

---

## 1단계. Google Cloud 현황 확인 + 예산 알림

PC 브라우저에서 진행한다.

1. https://console.cloud.google.com 에 접속한다.
2. 화면 위쪽 프로젝트 선택 상자에서 `gen-lang-client-0746071282`를 고른다. 목록에 보이지 않으면 "전체" 탭에서 찾는다.
3. 왼쪽 메뉴(또는 위쪽 검색창)에서 **Cloud Run**으로 들어간다.
4. 서비스 목록에서 지금 앱이 쓰는 서비스를 찾아 아래 세 가지를 메모한다.
   - 서비스 이름 (예: `expendbreak`)
   - 리전 (예: `us-west1`, `asia-northeast3`)
   - URL (예: `https://expendbreak-xxxx.us-west1.run.app`). 앱의 `.env.production.local`에 있는 `VITE_API_BASE_URL`과 같아야 한다.
5. 서비스를 눌러 **수정 및 새 버전 배포 → 변수 및 보안 비밀** 탭에서 환경변수 이름 목록만 확인한다(값은 메모하지 않는다). `APP_PIN_HASH`, `APP_SESSION_SECRET`, `GEMINI_API_KEY` 등이 여기 있어야 한다. 확인만 하고 저장하지 말고 취소한다.
   - 자동 배포는 이 환경변수를 그대로 둔 채 프로그램만 바꾼다.
6. 위쪽 검색창에 **결제(Billing)** 를 검색해 이 프로젝트에 결제 계정이 연결돼 있는지 본다.
   - 연결돼 있지 않으면 여기서 멈추고 Claude에게 알린다. 그 상태에서 지금 Firebase Storage가 어떻게 동작 중인지부터 확인해야 한다.
7. 결제 → **예산 및 알림 → 예산 만들기**
   - 범위: 이 프로젝트만
   - 금액: 1,000원 (또는 원하는 금액)
   - 알림 기준: 50%, 90%, 100%
   - 주의: 예산 알림은 메일만 보낸다. 사용을 자동으로 멈추지는 않는다.

메모할 값:

```text
서비스 이름:
리전:
URL:
```

---

## 2단계. GitHub과 Google Cloud 연결

GitHub이 키 파일 없이 이 저장소에서 온 요청일 때만 Google Cloud에 배포할 수 있게 한다. 이 방식은 Workload Identity Federation이라고 부르며, 저장소에 이미 있는 보안 규칙 자동 배포(`.github/workflows/deploy-rules.yml`)도 이 연결이 필요하다. 지금은 이 연결이 없어서 2026-10-01 보안 규칙 자동 배포가 실패한 상태다.

PC에 아무것도 설치하지 않고, 브라우저 안의 터미널(Cloud Shell)에서 한다.

1. Google Cloud 콘솔 오른쪽 위의 `>_` 아이콘(Cloud Shell 활성화)을 누른다. 아래쪽에 터미널이 열린다.
2. 아래 블록의 첫 두 줄에서 리전을 1단계에서 메모한 값으로 바꾼 뒤, 블록 전체를 붙여넣고 Enter를 누른다. 중간에 API 사용 승인을 물으면 `y`를 입력한다.

```bash
PROJECT_ID=gen-lang-client-0746071282
REGION=us-west1
GITHUB_REPO=iii5412/expendBreak
gcloud config set project $PROJECT_ID
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA=github-deployer@$PROJECT_ID.iam.gserviceaccount.com

gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebaserules.googleapis.com

gcloud iam service-accounts create github-deployer --display-name="GitHub deploy"

for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/firebaserules.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$SA --role=$ROLE --condition=None
done

gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO'"

gcloud iam service-accounts add-iam-policy-binding $SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"
```

각 줄이 하는 일:

- 배포 전용 계정 `github-deployer`를 만든다. 사람이 아니라 GitHub이 쓰는 계정이다.
- 이 계정에 Cloud Run 배포, 서버 이미지 업로드, 보안 규칙 배포 권한만 준다. Firestore 데이터를 읽거나 지우는 권한은 주지 않는다.
- `attribute-condition` 줄 때문에 `iii5412/expendBreak` 저장소에서 실행된 GitHub 작업만 이 계정을 쓸 수 있다. 저장소가 공개여도 다른 사람의 저장소나 복사본(fork)에서는 쓸 수 없다.

3. 서버 이미지 보관함을 만들고, 오래된 이미지를 자동으로 지워 무료 보관량(0.5GB)을 넘지 않게 한다. 같은 Cloud Shell에 이어서 붙여넣는다.

```bash
gcloud artifacts repositories create expendbreak --repository-format=docker --location=$REGION

cat > cleanup.json <<'EOF'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "604800s"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies expendbreak --location=$REGION --policy=cleanup.json --no-dry-run
```

최근 3개는 항상 남기고(문제가 생기면 이전 버전으로 되돌릴 때 쓴다), 7일 넘은 나머지는 지운다.

4. GitHub에 등록할 값을 출력한다.

```bash
echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider"
echo "GCP_SERVICE_ACCOUNT = $SA"
echo "GCP_PROJECT_ID = $PROJECT_ID"
echo "GCP_REGION = $REGION"
```

출력된 네 줄을 복사해 둔다. 비밀값이 아니므로 Claude에게 그대로 보내도 된다.

오류가 나면: 오류 메시지 전체를 복사해 Claude에게 보낸다. 이미 만든 것을 다시 만들려 할 때 나는 `already exists`는 무시해도 된다.

---

## 3단계. GitHub 저장소에 설정값 등록

방법 A. Claude에게 맡기기: 2단계에서 출력된 네 줄과 1단계의 서비스 이름, URL을 보내면 Claude가 `gh` 명령으로 등록한다.

방법 B. 직접 하기:

1. https://github.com/iii5412/expendBreak/settings/variables/actions 로 들어간다.
2. **New repository variable**로 아래 여섯 개를 하나씩 추가한다. Secrets 탭이 아니라 Variables 탭이다.

| 이름 | 값 |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | 2단계 출력값 |
| `GCP_SERVICE_ACCOUNT` | 2단계 출력값 |
| `GCP_PROJECT_ID` | `gen-lang-client-0746071282` |
| `GCP_REGION` | 1단계 리전 |
| `CLOUD_RUN_SERVICE` | 1단계 서비스 이름 |
| `VITE_API_BASE_URL` | 1단계 URL (끝에 `/` 없이) |

---

## 4단계. 배포 설정·앱 자동 업데이트 코드 (Claude 작업)

Claude가 아래를 만들고, 테스트를 통과시킨 뒤 커밋한다.

1. 서버 실행 환경 정의 파일(`Dockerfile`). 배포할 때 무엇을 설치하고 어떻게 실행할지 적는다.
2. 자동 배포 작업(`.github/workflows/deploy.yml`)
   - main에 반영되면 자동 검사(타입 체크, 테스트, 보안 규칙 테스트)를 먼저 돌린다.
   - 통과했을 때만 서버 이미지를 만들어 Cloud Run에 배포한다. 실패하면 배포하지 않으며 지금 운영 중인 서버는 그대로다.
   - 배포 후 `/healthz`가 정상인지 확인한다.
3. 앱 자동 업데이트
   - 배포할 때 안드로이드용 화면 묶음(zip)과 버전 정보 파일을 서버에 같이 올린다.
   - 앱은 켜질 때 버전을 확인해 새 화면을 백그라운드로 받고, 다음 실행 때 적용한다.
   - 받은 파일이 손상됐으면 쓰지 않는다.
   - 새 화면이 정상적으로 켜지지 않으면 이전 화면으로 되돌아간다.
   - 안드로이드 쪽 기능(위젯, 문자 읽기, 새 플러그인)이 바뀐 화면은 그 기능이 들어 있는 APK에서만 받는다.
4. AI 작업 지침 파일(`CLAUDE.md`, `AGENTS.md`). Claude와 Codex가 이 저장소에서 지켜야 할 규칙(검사 명령, 보안 규칙, 데이터 보호)을 적는다.

준비물: 지금 커밋되지 않은 변경(카드 명세서 대조, 재무 챗 수정 등)을 먼저 검사하고 커밋해야 한다. 그대로 두면 첫 자동 배포에 섞여 운영에 올라간다.

---

## 5단계. 마지막 APK 한 번 설치

자동 업데이트 기능 자체는 APK 안에 들어가야 하므로 이번 한 번은 직접 설치해야 한다.

```powershell
npm run android:release
```

만들어진 `android/app/build/outputs/apk/release/app-release.apk`를 지금처럼 폰에 설치한다. 기존과 같은 서명 키를 쓰므로 데이터는 유지된다.

이후 APK를 다시 설치해야 하는 경우는 안드로이드 쪽 기능을 바꿀 때뿐이다. 그때 쓸 APK 자동 빌드(Firebase App Distribution 알림)는 이번 단계가 안정되면 별도로 붙인다.

주의: 서명 키 `android/release-key.jks`와 `android/keystore.properties`를 잃어버리면 기존 앱 위에 업데이트를 설치할 수 없다. PC 밖(외장 저장장치, 개인 클라우드)에도 백업해 둔다.

---

## 6단계. 폰에서 쓰는 AI 연결

둘 중 하나 또는 둘 다.

Claude Code:

1. 폰에 Claude 앱을 설치하고 로그인한다.
2. Code 메뉴에서 GitHub 계정을 연결하고 `iii5412/expendBreak` 저장소를 고른다.
3. 요청을 입력하면 클라우드에서 작업한 뒤 변경 요청(PR)을 올린다.

Codex:

1. https://chatgpt.com/codex 에서 GitHub을 연결하고 같은 저장소를 고른다.
2. 폰의 ChatGPT 앱 Codex 메뉴에서 요청하면 변경 요청(PR)을 올린다.

승인:

1. 폰에 GitHub 앱을 설치한다.
2. 올라온 변경 요청에서 자동 검사가 모두 초록색인지 확인한다.
3. **Merge** 를 누르면 자동 배포가 시작된다.

주의: 저장소가 공개라 코드는 누구나 볼 수 있다. 비밀번호, API 키, PIN은 코드나 요청 내용에 절대 넣지 않는다. 이런 값은 1단계에서 본 Cloud Run 환경변수에만 둔다.

---

## 7단계. 처음부터 끝까지 시험

1. 폰에서 AI에게 작은 수정을 요청한다. 예: "설정 화면 맨 아래에 앱 화면 버전을 작게 표시해줘"
2. 올라온 변경 요청을 Merge 한다.
3. GitHub 앱의 Actions 탭에서 배포가 끝나는지 본다(약 5~10분).
4. 앱을 완전히 종료했다가 켠다. 이때 새 화면을 받는다.
5. 한 번 더 종료했다가 켜면 바뀐 화면이 보인다.

---

## 바꾼 뒤 지킬 것

- **AI Studio의 배포 버튼은 더 이상 누르지 않는다.** AI Studio 안에 있는 예전 코드가 운영 서버를 덮어쓸 수 있다. AI Studio 배포가 환경변수까지 바꾸는지는 확인하지 못했다.
- 문제가 생기면 Cloud Run 콘솔 → 서비스 → **버전(Revisions)** 탭에서 이전 버전을 골라 트래픽을 100% 보내면 바로 되돌아간다.
- 보안 규칙(`firestore.rules`, `storage.rules`)을 바꾸는 변경은 앱 배포와 따로 검증한다. 순서는 `docs/DEPLOYMENT.md`를 따른다.
