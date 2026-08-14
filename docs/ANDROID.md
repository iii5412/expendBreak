# 지출브레이크 Android 앱·위젯 빌드

## 구현 범위

- Capacitor 8 기반 독립 설치형 Android 앱
- 앱 ID `com.iii5412.expendbreak`, Android 8.0(API 26) 이상
- Jetpack Glance 홈 화면 위젯
- 위젯에서 남은 변동예산, 하루 안전금액, 남은 일수 표시
- 위젯 새로고침 및 지출 등록 화면 딥링크
- 잠금 연동, 금액 숨김, 항상 표시의 세 가지 개인정보 모드
- Android Keystore AES-GCM을 사용한 위젯 스냅샷 암호화

## 필수 준비

Android 앱은 번들 내부의 `https://localhost`에서 실행되므로 운영 API 주소가 반드시 필요하다. 루트 `.env.production.local`에 실제 배포 주소를 설정한다.

```dotenv
VITE_API_BASE_URL=https://your-deployed-site.example
```

경로 없이 HTTPS origin만 사용한다. 이 값이 없으면 `npm run android:sync`, `android:debug`, `android:release`가 중단된다.

운영 서버에는 다음 값을 적용한다.

```dotenv
APP_URL=https://your-deployed-site.example
NATIVE_ALLOWED_ORIGINS=https://localhost
```

현재 서버 코드는 PIN 성공 시 API 세션 토큰과 Firebase custom token을 함께 발급한다. 배포 서비스 계정에는 Firebase custom token 서명 권한이 필요하다. 서버·웹 앱을 먼저 배포하고 로그인을 검증한 뒤 강화된 Firestore/Storage rules를 배포한다.

## 개발용 APK

JDK 21과 Android SDK Platform 36을 준비한 뒤 실행한다.

```powershell
npm install
npm run android:debug
```

산출물은 `android/app/build/outputs/apk/debug/app-debug.apk`이다. 개발용 서명이므로 개인 테스트에만 사용한다.

USB 디버깅이 연결된 기기에는 다음처럼 설치할 수 있다.

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 업데이트 가능한 릴리스 APK

한 번 만든 release keystore는 이후 업데이트에서도 반드시 같은 파일과 alias를 사용한다. 분실하면 기존 앱 위에 업데이트할 수 없다.

```powershell
keytool -genkeypair -v -keystore android/release-key.jks -alias expendbreak -keyalg RSA -keysize 2048 -validity 10000
Copy-Item android/keystore.properties.example android/keystore.properties
```

`android/keystore.properties`의 비밀번호를 실제 값으로 바꾼 다음 빌드한다. keystore와 properties는 Git에서 제외된다.

```powershell
npm run android:release
```

산출물은 `android/app/build/outputs/apk/release/app-release.apk`이다. 배포 전 `apksigner verify --verbose`와 실제 기기 설치를 확인한다.

## 앱 안에서 APK 업데이트

버전 1.2.0(빌드 3)부터 설정의 `Android 앱과 위젯` 카드에서 새 APK를 확인하고 설치할 수 있다. 새 릴리스를 만들 때마다 다음을 지킨다.

1. `android/app/build.gradle`의 `versionCode`를 반드시 증가시키고 `versionName`을 변경한다.
2. 최초 릴리스와 동일한 keystore 및 alias로 `npm run android:release`를 실행한다.
3. 운영 서버가 읽을 수 있는 영구 경로에 서명된 APK를 업로드한다.
4. 운영 서버에 아래 환경 변수를 적용하고 재시작한다.

```dotenv
APP_UPDATE_APK_PATH=/absolute/server/path/expendbreak-v1.3.0-4.apk
APP_UPDATE_VERSION_CODE=4
APP_UPDATE_VERSION_NAME=1.3.0
APP_UPDATE_RELEASE_NOTES=지출 추가 화면과 4x2 위젯의 퀵등록 개선
```

서버의 `/api/app-update`는 APK 크기와 SHA-256을 계산해 제공하고, `/api/app-update/apk`는 실제 파일을 전송한다. 앱은 설치된 `versionCode`보다 큰 업데이트만 표시하며 다운로드 완료 후 SHA-256이 일치할 때만 Android 패키지 설치 화면을 연다. Android 8 이상에서는 최초 업데이트 때 `이 출처의 앱 허용` 설정이 한 번 필요하다.

업데이트가 기존 앱 위에 설치되려면 APK의 application ID와 서명키가 기존 앱과 같아야 하며 `versionCode`는 더 커야 한다. 서명키를 분실하거나 바꾸면 앱 내부 데이터가 유지되는 덮어쓰기가 불가능하다.

## 위젯 사용

1. 앱에 PIN으로 로그인한다.
2. 설정의 `Android 앱 · 위젯`에서 개인정보 모드를 선택한다.
3. `홈 화면에 위젯 추가`를 누르거나 휴대폰 홈 화면의 위젯 목록에서 지출브레이크를 선택한다.
4. 앱에서 데이터가 갱신될 때 위젯 스냅샷도 갱신된다. 앱이 오랫동안 실행되지 않으면 위젯은 최신 동기화를 요청한다.

위젯은 백그라운드에서 Firestore에 직접 로그인하지 않는다. 앱이 계산한 최소 요약값만 암호화해 저장하므로 계좌번호, 거래 메모, 전체 거래내역은 위젯 저장소에 포함하지 않는다.
