# PokéFollower

> 🇺🇸 English: [README.md](README.md) &nbsp;·&nbsp; 🇰🇷 한국어: README.ko.md

화면 위의 작은 친구. 레트로 2D 포켓몬 스프라이트가 커서를 따라다니며 가만히
서 있기도 하고, 걷기도 하고, 움직이는 방향으로 몸을 돌립니다.

이 저장소는 **Ali Hamad**가 만든
[ThinkrDoer/pokefollower_cursor_web_plugin](https://github.com/ThinkrDoer/pokefollower_cursor_web_plugin)의
포크입니다. 원작은 웹 페이지에 팔로워를 띄워 주는 Chrome 확장 프로그램입니다.
이 포크는 그 확장을 그대로 유지하면서, 같은 포켓몬이 브라우저뿐 아니라 **데스크톱
전체에서 — 모든 앱 위로 — 커서를 따라다니도록** 하는 네이티브 **macOS 데스크톱
앱**을 추가했습니다.

---

## macOS 데스크톱 앱

데스크톱 앱은 확장의 스프라이트 엔진을 감싼 Electron 래퍼입니다. 투명한
클릭 통과(click-through) 오버레이가 다른 창들 위에 떠 있고, 확장의 설정 팝업을
수정 없이 그대로 네이티브 설정 창으로 재사용합니다.

### 빠른 시작

명령어 한 줄이면 의존성 설치, Electron 바이너리 무결성 검사 실패 시 자동 복구,
smoke 검증, 빌드, `/Applications` 설치, 실행까지 전부 자동으로 진행됩니다:

```bash
npm run setup:mac
```

### 수동 실행

각 단계를 직접 실행하고 싶다면:

```bash
npm install        # 의존성 설치
npm run app        # 개발 모드로 실행 (Electron)
npm run dist       # 독립 실행형 .app 빌드 (서명 없음)
```

`npm run dist`는 서명되지 않은 `PokeFollower.app`을 `dist/` 아래에 만듭니다.

### 사용법

이 앱에는 Dock 아이콘이 없습니다. 메뉴 막대에 포켓볼 아이콘으로 상주합니다.
트레이 메뉴에서 다음을 할 수 있습니다:

- 팔로워 **켜기 / 끄기** (Enable / Disable)
- **설정 열기** (Settings…)
- **종료** (Quit)

켜면 스프라이트는:

- 포커스를 절대 빼앗지 않는 **클릭 통과 오버레이** 위에 떠서, 작업을 방해하지
  않고 위를 부드럽게 떠다니고,
- **디스플레이 사이를 넘나들며 커서를 따라다니며**, 커서가 있는 모니터로 이동하고,
- 커서 움직임이 **약 30초 동안 없으면 잠에 듭니다**. 다시 움직이면 깨어납니다
  (수면 애니메이션이 포함된 팩 한정).

### 설정 창

**설정…**을 열면 브라우저 확장 팝업과 동일한 UI가 나타납니다:

- **포켓몬 선택** — 목록에서 고르거나, 이름 또는 도감 번호로 **검색**하거나,
  **셔플**로 무작위 선택.
- **SCALE** — 스프라이트를 얼마나 크게 그릴지.
- **DISTANCE** — 커서에서 얼마나 떨어져 자리 잡을지.
- **SPEED** — 커서를 움직일 때 얼마나 빨리 따라붙을지.
- **언어 (EN / 한글)** — **포켓몬 이름과 검색 제안을 한글로** 표시합니다
  (이 포크에서 새로 추가된 기능).

설정은 다음 위치에 저장됩니다:

```
~/Library/Application Support/pokefollower_cursor_web_plugin/settings.json
```

### 첫 실행 (서명 없는 앱)

빌드된 앱은 코드 서명이 되어 있지 않아, 첫 실행 시 macOS Gatekeeper가 바로 열기를
거부합니다. 최초 한 번만 아래처럼 실행하세요:

1. Finder에서 `PokeFollower.app`을 **우클릭**(또는 Control-클릭)합니다.
2. **열기**를 선택합니다.
3. 대화상자에서 다시 **열기**를 눌러 확인합니다.

이후부터는 평소처럼 바로 열립니다.

---

## Chrome 확장 프로그램

원본 확장을 Chrome(또는 Chromium 계열 브라우저)에서 실행하려면:

1. `chrome://extensions`로 이동합니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 눌러 `src/` 폴더를 선택합니다.

그러면 웹 페이지에 팔로워가 나타나며, 데스크톱 앱과 동일한 설정 팝업을 사용합니다.

---

## 개발

데스크톱 앱은 의도적으로 확장의 **`src/` 코드를 수정 없이 재사용**합니다. 얇은
Electron 계층이 확장이 기대하는 Chrome의 역할을 대신합니다:

- **`desktop/main.cjs`** — Electron 래퍼. 투명 오버레이 창을 만들고, 커서
  위치를 창 로컬 좌표로 약 60Hz로 전달하고, 오버레이를 디스플레이 사이로 이동시키고,
  트레이 메뉴를 구성하고, 설정 창을 엽니다.
- **`desktop/shim-preload.cjs`** — 작은 `chrome.*` shim. Electron IPC 위에서
  `chrome.storage.sync/local`(`get`/`set`/`onChanged`)과
  `chrome.runtime`(`getURL`/`sendMessage`/`onMessage`/`id`)을 구현해, `src/popup`과
  `src/content.js`가 아무 수정 없이 동작하게 합니다.
- **`poke://` 프로토콜** — 저장소 파일을 커스텀 `poke://app/<path>` 스킴으로
  제공해, 팩 JSON과 에셋에 대해 `fetch()`가 동작하게 합니다 (`file://` 스킴은
  fetch를 막습니다).
- **`src/`** — 공유되는 스프라이트 엔진(`content.js`)과 설정 팝업(`popup/`).
  확장과 데스크톱 앱이 완전히 동일하게 사용합니다.

### Smoke 테스트

```bash
npm run app:smoke
```

Smoke 테스트는 앱을 헤드리스로 부팅해 핵심 경로를 처음부터 끝까지 검증합니다:

- **오버레이 스프라이트**가 로드되어 렌더링되는지,
- **설정 창**이 로드되어 팩을 읽어오는지,
- **8방향 facing**이 올바르게 결정되는지,
- **언어 전환**(EN / 한글)이 동작하는지.

성공하면 `SMOKE_OK`를 출력하고 `0`으로 종료합니다.

### 한글 이름

```bash
npm run build:ko-names
```

언어 전환에서 사용하는 한글 포켓몬 이름 조회 파일
`src/assets/packs/names-ko.json`(도감 번호 기준)을 다시 생성합니다.
`src/assets/packs/index.json`을 기반으로 PokéAPI에서 이름을 가져옵니다.

---

## 크레딧 & 라이선스

- **코드** — MIT License, © Ali Hamad 및 기여자들. [CREDITS.txt](CREDITS.txt) 참고.
- **스프라이트** — [PMD Sprite Collab](https://sprites.pmdcollab.org) 커뮤니티
  제작물이며, **Creative Commons BY-NC-SA 4.0**로 사용됩니다. 비상업적 용도에 한합니다.
- **포켓몬** — 포켓몬 및 관련된 모든 이름과 이미지는 **Nintendo / Game Freak /
  The Pokémon Company**의 지적 재산입니다.

이 프로젝트는 팬이 만든 **개인적, 비상업적** 결과물입니다. Nintendo, Game Freak,
The Pokémon Company와 제휴 관계가 없으며 승인받지 않았습니다.

전체 출처 표기는 [CREDITS.txt](CREDITS.txt)에 있습니다.
