#!/usr/bin/env bash
set -euo pipefail

# ── J.A.R.V.I.S. Installer ──────────────────────────────────────────
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/vierisid/jarvis/main/install.sh | bash
#
# What this does:
#   1. Detects your OS (macOS / Linux / WSL)
#   2. Installs Bun if not already installed
#   3. Installs @jarvis-ai/daemon globally
#   4. Runs the interactive setup wizard
#
# ─────────────────────────────────────────────────────────────────────

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

print_banner() {
  echo -e "${CYAN}"
  echo "     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗"
  echo "     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝"
  echo "     ██║███████║██████╔╝██║   ██║██║███████╗"
  echo "██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║"
  echo "╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║"
  echo " ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝"
  echo -e "${RESET}"
  echo -e "${DIM}  Just A Rather Very Intelligent System${RESET}"
  echo ""
}

info() { echo -e "  ${CYAN}○${RESET} $1"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}!${RESET} $1"; }
err()  { echo -e "  ${RED}✗${RESET} $1"; }

# ── Detect OS ────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)
      if grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    *) echo "unknown" ;;
  esac
}

# ── Main ─────────────────────────────────────────────────────────────

main() {
  print_banner

  OS=$(detect_os)
  echo -e "${BOLD}Detected OS:${RESET} ${OS}"
  echo ""

  if [ "$OS" = "unknown" ]; then
    err "Unsupported operating system. JARVIS supports macOS, Linux, and WSL."
    exit 1
  fi

  # ── Step 1: Check / Install Bun ──────────────────────────────────

  echo -e "${CYAN}[1/3]${RESET} ${BOLD}Checking Bun runtime...${RESET}"

  if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    ok "Bun v${BUN_VERSION} is installed"
  else
    info "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash

    # Source the updated PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if command -v bun &> /dev/null; then
      ok "Bun installed successfully (v$(bun --version))"
    else
      err "Failed to install Bun. Please install manually: https://bun.sh"
      exit 1
    fi
  fi

  echo ""

  # ── Step 2: Install JARVIS ──────────────────────────────────────

  echo -e "${CYAN}[2/3]${RESET} ${BOLD}Installing J.A.R.V.I.S...${RESET}"

  bun install -g @jarvis-ai/daemon

  if command -v jarvis &> /dev/null; then
    JARVIS_VERSION=$(jarvis version)
    ok "JARVIS v${JARVIS_VERSION} installed"
  else
    # May need to add bun global bin to PATH
    warn "jarvis command not in PATH. Adding to shell config..."

    BUN_BIN="$HOME/.bun/bin"
    SHELL_NAME=$(basename "$SHELL")

    case "$SHELL_NAME" in
      zsh)  PROFILE="$HOME/.zshrc" ;;
      bash) PROFILE="$HOME/.bashrc" ;;
      fish) PROFILE="$HOME/.config/fish/config.fish" ;;
      *)    PROFILE="$HOME/.profile" ;;
    esac

    if ! grep -q "\.bun/bin" "$PROFILE" 2>/dev/null; then
      echo "" >> "$PROFILE"
      echo "# Bun global bin" >> "$PROFILE"
      echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> "$PROFILE"
      info "Added bun bin to ${PROFILE}"
    fi

    export PATH="$BUN_BIN:$PATH"

    if command -v jarvis &> /dev/null; then
      ok "JARVIS installed (restart your terminal for PATH changes)"
    else
      err "Installation may have failed. Try: bun install -g @jarvis-ai/daemon"
      exit 1
    fi
  fi

  echo ""

  # ── Step 3: Run Onboard Wizard ─────────────────────────────────

  echo -e "${CYAN}[3/3]${RESET} ${BOLD}Running setup wizard...${RESET}"
  echo ""

  jarvis onboard
}

main "$@"
