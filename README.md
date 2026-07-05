# PokéFollower

> 🇰🇷 한국어 (현재 문서) &nbsp;·&nbsp; 🇺🇸 [English](README.en.md)

화면 위를 함께하는 작은 친구입니다. 레트로 2D 포켓몬 스프라이트가 커서를
따라다니며 가만히 서 있기도 하고, 걷기도 하고, 움직이는 방향을 바라봅니다.

이 저장소는 **Ali Hamad**가 만든
[ThinkrDoer/pokefollower_cursor_web_plugin](https://github.com/ThinkrDoer/pokefollower_cursor_web_plugin)의
포크입니다. 원작은 웹 페이지 위에 팔로워를 띄우는 Chrome 확장 프로그램입니다.
이 포크는 그 확장을 그대로 유지하면서, 같은 포켓몬이 브라우저뿐 아니라
**데스크톱 전체에서 — 모든 앱 위로 — 커서를 따라다니도록** 하는 네이티브
**macOS 데스크톱 앱**을 새로 추가했습니다.

---

## 기능

- **Follow 모드** — 커서를 따라다닙니다. 8방향 스프라이트로 이동 방향을 그대로
  바라보고, 목적지에 도착하면 커서 위에 안착하며, 30초 동안 커서 움직임이
  없으면 잠듭니다(수면 애니메이션이 있는 팩 한정).
- **Wander 모드** — 커서와 무관하게 화면을 자유롭게 배회합니다. 무작위 지점으로
  이동한 뒤 2~8초 쉬고, 쉬는 동안 10% 확률로 낮잠에 들거나(sleep 상태가 있는
  팩만) 15% 확률로 제자리에서 공격 모션을 재생합니다(attack 상태가 있는 팩만).
- **멀티 디스플레이** — 연결된 모든 디스플레이 위에 각각 오버레이가 뜨고,
  디스플레이 경계는 창이 순간이동하는 게 아니라 실제로 걸어서 건너갑니다.
- **포켓몬 493마리** (1~4세대, 전국도감 001 이상해씨부터 493 아르세우스까지) —
  스케일(SCALE) / 거리(DISTANCE) / 속도(SPEED) 조절과 이름 표시 언어(EN/한글)
  전환을 지원합니다.
- macOS 앱은 **Dock 아이콘이 없는 메뉴바 전용** 앱입니다. 메뉴바의 포켓볼
  아이콘이 유일한 진입점이므로, 메뉴바가 다른 아이콘들로 혼잡하면 포켓볼
  아이콘이 가려져 안 보일 수 있습니다 — 실제로 겪을 수 있는 상황이니
  참고하세요. (macOS 메뉴바 설정에서 아이콘 순서를 조정하거나 다른 항목을
  줄이면 다시 보입니다.)

---

## 설치 (macOS 앱)

### 요구사항

- **macOS 11 (Big Sur) 이상** — 앱이 사용하는 Electron 33의 최소 지원 버전입니다.
- **Node.js 20 이상**

### 원커맨드 설치

```bash
npm run setup:mac
```

환경 확인 → 의존성 설치 → Electron 바이너리 무결성 확인(손상 시 자동 복구) →
스모크 테스트 → 빌드 → `/Applications` 설치 → 실행까지 한 번에 진행됩니다.

### Apple Silicon / Intel 모두 지원

네이티브 모듈을 전혀 사용하지 않으므로, 위 명령어 하나로 두 아키텍처 모두에서
그대로 빌드됩니다. `electron-builder`가 빌드를 실행한 머신의 아키텍처에 맞는
바이너리를 만들어 주므로, 인텔 맥에서도 동일하게 저장소를 클론하고
`npm run setup:mac`을 실행하면 됩니다. 코드를 수정할 필요는 없습니다.

### 수동 실행

각 단계를 직접 실행하고 싶다면:

```bash
npm install        # 의존성 설치
npm run app        # 개발 모드로 실행 (Electron)
npm run dist       # 독립 실행형 .app 빌드 (서명 없음)
```

`npm run dist`는 서명되지 않은 `PokeFollower.app`을 `dist/` 아래에 만듭니다.

### 첫 실행 (서명 없는 앱)

빌드된 앱은 코드 서명이 되어 있지 않아, 첫 실행 시 macOS Gatekeeper가 바로
열기를 거부합니다. 최초 한 번만 아래처럼 실행하세요:

1. Finder에서 `PokeFollower.app`을 **우클릭**(또는 Control-클릭)합니다.
2. **열기**를 선택합니다.
3. 대화상자에서 다시 **열기**를 눌러 확인합니다.

이후부터는 평소처럼 바로 열립니다.

---

## 설치 (Chrome 확장 프로그램)

원본 확장을 Chrome(또는 Chromium 계열 브라우저)에서 실행하려면:

1. `chrome://extensions`로 이동합니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 눌러 `src/` 폴더를 선택합니다.

웹 페이지에 팔로워가 나타나며, macOS 앱과 동일한 설정 팝업을 사용합니다.

---

## 사용법

메뉴바의 포켓볼 아이콘을 클릭하면 다음 메뉴가 나타납니다:

- 팔로워 **켜기 / 끄기** (Enable / Disable)
- **설정 열기** (Settings…)
- **종료** (Quit)

**설정…** 창은 브라우저 확장 팝업과 동일한 UI를 보여줍니다:

- **포켓몬 선택** — 목록에서 고르거나, 이름 또는 도감 번호로 **검색**하거나,
  **셔플**로 무작위 선택.
- **모드 (Follow / Wander)** — 커서를 따라다니는 Follow와 화면을 자유롭게
  배회하는 Wander 사이를 전환합니다.
- **SCALE** — 스프라이트를 얼마나 크게 그릴지.
- **DISTANCE** — 커서에서 얼마나 떨어져 자리 잡을지 (Follow 모드).
- **SPEED** — 커서를 움직일 때 얼마나 빨리 따라붙을지 (Follow 모드).
- **언어 (EN / 한글)** — 포켓몬 이름과 검색 제안을 한글로 표시합니다(이 포크에서
  새로 추가된 기능).

설정은 다음 위치에 저장됩니다:

```
~/Library/Application Support/pokefollower_cursor_web_plugin/settings.json
```

---

## 개발

데스크톱 앱은 의도적으로 확장의 **`src/` 코드를 수정 없이 재사용**합니다. 얇은
Electron 계층이 확장이 기대하는 Chrome의 역할을 대신합니다.

구조 개요:

- **`src/content.js`** — 공유 스프라이트 엔진. Follow/Wander 상태 머신, 8방향
  facing, 애니메이션 프레임 처리 등 핵심 로직이 모두 여기 있습니다.
- **`src/popup/`** — 설정 UI(팝업). 확장과 데스크톱 앱이 완전히 동일하게
  사용합니다.
- **`desktop/`** — Electron 래퍼. `main.cjs`가 디스플레이마다 오버레이 창을
  하나씩 만들고, 원본 커서 위치를 엔진 창에 전달하고, 트레이 메뉴와 설정 창을
  관리합니다. `shim-preload.cjs`는 `chrome.storage`/`chrome.runtime`을 흉내 낸
  얇은 shim이라, `src/popup`과 `src/content.js`가 아무 수정 없이 동작합니다.
  `mirror.html`/`mirror-preload.cjs`/`mirror-render.js`는 엔진을 맡지 않은
  나머지 디스플레이에서, 엔진의 매 프레임 스냅샷을 그대로 비추기만 합니다
  (물리 시뮬레이션은 하나만 돌고 나머지는 수동적으로 따라 그립니다).
- **`src/assets/`** — 세대별 스프라이트 팩과 팩 인덱스.

### 개발 모드 실행

```bash
npm run app
```

### 스모크 테스트

```bash
npm run app:smoke
```

앱을 헤드리스로 부팅해 오버레이 렌더링, 설정 창 로드, 8방향 facing, 언어
전환까지 핵심 경로를 자동으로 검증합니다. 성공하면 `SMOKE_OK`를 출력하고 `0`으로
종료합니다.

### 빌드만 실행

```bash
npm run dist
```

`electron-builder`로 서명되지 않은 `.app`만 만들고 설치·실행은 하지 않습니다.

### 한글 이름 재생성

```bash
npm run build:ko-names
```

언어 전환에서 쓰는 한글 포켓몬 이름 조회 파일
`src/assets/packs/names-ko.json`(도감 번호 기준)을 다시 생성합니다.
`src/assets/packs/index.json`을 기반으로 PokéAPI에서 이름을 가져옵니다.

---

## 크레딧 & 라이선스

- **코드** — MIT License, © Ali Hamad 및 기여자들. [CREDITS.txt](CREDITS.txt) 참고.
- **스프라이트** — [PMD Sprite Collab](https://sprites.pmdcollab.org) 커뮤니티
  아티스트들의 작업물이며, **Creative Commons BY-NC 4.0**으로 사용됩니다.
  비상업적 용도에 한하며, 출처 표기가 필요합니다.
- **포켓몬** — 포켓몬 및 관련된 모든 이름과 이미지는 **Nintendo / Game Freak /
  The Pokémon Company**의 지적 재산입니다.

이 프로젝트는 팬이 만든 **개인적, 비상업적** 결과물입니다. Nintendo, Game Freak,
The Pokémon Company와 제휴 관계가 없으며 승인받지 않았습니다.

전체 출처 표기는 [CREDITS.txt](CREDITS.txt)에 있습니다.
