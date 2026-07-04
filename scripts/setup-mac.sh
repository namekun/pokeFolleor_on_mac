#!/usr/bin/env bash
set -euo pipefail

# PokeFollower — macOS one-command setup
#   npm run setup:mac            전체 설치 (환경확인 → 의존성 → Electron 무결성 →
#                                스모크 → 빌드 → /Applications 설치 → 실행)
#   npm run setup:mac -- --check 진단만 (1~3단계까지, CI/빠른 점검용)

# 어디서 실행하든 repo 루트로 이동 (scripts/..)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
fi

# ── palette (tty일 때만 색 사용) ─────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; D=$'\033[2m'; RS=$'\033[0m'
  GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; CYN=$'\033[36m'
else
  B=""; D=""; RS=""; GRN=""; RED=""; YLW=""; CYN=""
fi

TOTAL=6
[ "$CHECK_ONLY" = "1" ] && TOTAL=3

FW="node_modules/electron/dist/Electron.app/Contents/Frameworks"

hr()   { printf '%s────────────────────────────────────────────%s\n' "$D" "$RS"; }
step() { printf '\n%s%s[%d/%d]%s %s%s%s\n' "$B" "$CYN" "$1" "$TOTAL" "$RS" "$B" "$2" "$RS"; }
ok()   { printf '   %s✔%s %s\n' "$GRN" "$RS" "$1"; }
info() { printf '   %s•%s %s\n' "$D" "$RS" "$1"; }
warn() { printf '   %s▲%s %s\n' "$YLW" "$RS" "$1"; }
die()  { printf '\n%s✘ %s%s\n' "$RED" "$1" "$RS" >&2; exit 1; }

# ── Electron 바이너리 자동 복구 ──────────────────────────────
# 배경: extract-zip이 가끔 Frameworks/심링크를 누락시켜 dist가 손상됨.
# 캐시 zip을 ditto로 다시 풀어 복구한다.
repair_electron() {
  local version zip
  version="$(node -p "require('./node_modules/electron/package.json').version")"
  info "대상 버전: v${version}"

  # a. 손상된 dist 제거
  rm -rf node_modules/electron/dist

  # b. 캐시에서 zip 검색 (top-level + 해시 하위폴더 모두)
  zip="$(find "$HOME/Library/Caches/electron" -maxdepth 2 \
          -name "electron-v${version}-darwin-*.zip" 2>/dev/null | head -1)"

  if [ -n "$zip" ] && [ -f "$zip" ]; then
    info "캐시 zip 발견: $zip"
    mkdir -p node_modules/electron/dist
    ditto -x -k "$zip" node_modules/electron/dist
  else
    # c. 캐시에 없으면 install.js로 재다운로드
    warn "캐시에 zip 없음 — Electron 재다운로드 (install.js)"
    ( cd node_modules/electron && node install.js )
  fi

  # 재확인: 그래도 Frameworks 없으면 방금 받아진 캐시 zip을 재추출
  if [ ! -d "$FW" ]; then
    warn "Frameworks 여전히 누락 — 캐시 zip 재추출 시도"
    zip="$(find "$HOME/Library/Caches/electron" -maxdepth 2 \
            -name "electron-v${version}-darwin-*.zip" 2>/dev/null | head -1)"
    if [ -n "$zip" ] && [ -f "$zip" ]; then
      info "재추출: $zip"
      rm -rf node_modules/electron/dist
      mkdir -p node_modules/electron/dist
      ditto -x -k "$zip" node_modules/electron/dist
    fi
  fi

  # d. path.txt 재작성
  printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
  info "path.txt 갱신"
}

# ── banner ───────────────────────────────────────────────────
hr
printf '%s🔴 PokeFollower — macOS 셋업%s\n' "$B" "$RS"
[ "$CHECK_ONLY" = "1" ] && printf '%s   check 모드: 진단만 수행 (1~3단계)%s\n' "$D" "$RS"
hr

# ── 1) 환경 확인 ─────────────────────────────────────────────
step 1 "환경 확인 (macOS / Node)"
[ "$(uname -s)" = "Darwin" ] || die "이 스크립트는 macOS 전용입니다 (감지된 OS: $(uname -s))."
ok "macOS 확인"

command -v node >/dev/null 2>&1 || die "Node.js가 없습니다. https://nodejs.org 에서 20+ 설치 후 다시 실행하세요."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node 20 이상이 필요합니다 (현재: $(node -v))."
fi
ok "Node $(node -v)"

# ── 2) 의존성 설치 ───────────────────────────────────────────
step 2 "의존성 설치 (npm install)"
npm install || die "npm install 실패 — 네트워크/권한을 확인하세요."
ok "의존성 설치 완료"

# ── 3) Electron 무결성 ───────────────────────────────────────
step 3 "Electron 바이너리 무결성 확인"
if [ -d "$FW" ]; then
  ok "Electron 바이너리 정상"
else
  warn "Electron 바이너리 손상/누락 감지 — 자동 복구 시작"
  repair_electron
  [ -d "$FW" ] || die "Electron 복구 실패: $FW 를 만들 수 없습니다."
  ok "Electron 복구 완료"
fi

if [ "$CHECK_ONLY" = "1" ]; then
  hr
  printf '%s✔ 진단 통과 — 설치 준비 완료%s\n' "$GRN" "$RS"
  hr
  exit 0
fi

# ── 4) 스모크 테스트 ─────────────────────────────────────────
step 4 "스모크 테스트 (npm run app:smoke)"
smoke_out="$(npm run app:smoke 2>&1)" || true
printf '%s\n' "$smoke_out" | grep "SMOKE" | sed 's/^/   │ /' || true
if ! grep -q "SMOKE_OK" <<<"$smoke_out"; then
  die "스모크 테스트 실패: 출력에 SMOKE_OK 가 없습니다."
fi
ok "스모크 테스트 통과"

# ── 5) 앱 빌드 ───────────────────────────────────────────────
step 5 "앱 빌드 (electron-builder)"
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist || die "빌드 실패 (electron-builder)."
ok "빌드 완료"

# ── 6) 설치 및 실행 ──────────────────────────────────────────
step 6 "설치 및 실행"
# electron-builder 출력 경로는 아키텍처에 따라 다름 (Apple Silicon: mac-arm64, Intel: mac)
APP_SRC=""
for candidate in dist/mac-arm64/PokeFollower.app dist/mac/PokeFollower.app dist/mac*/PokeFollower.app; do
  if [ -d "$candidate" ]; then APP_SRC="$candidate"; break; fi
done
[ -n "$APP_SRC" ] || die "빌드 산출물을 찾을 수 없습니다: dist/mac*/PokeFollower.app"
pkill -f "PokeFollower.app/Contents/MacOS/PokeFollower" 2>/dev/null || true
rm -rf /Applications/PokeFollower.app
cp -R "$APP_SRC" /Applications/
ok "/Applications/PokeFollower.app 설치"
open /Applications/PokeFollower.app
ok "앱 실행"

# ── 완료 ─────────────────────────────────────────────────────
hr
printf '%s🎉 완료!%s PokeFollower 가 실행되었습니다.\n' "$GRN" "$RS"
printf '   %s메뉴바(우측 상단)의 🔴 포켓볼 아이콘%s을 클릭해 설정을 여세요.\n' "$B" "$RS"
hr
