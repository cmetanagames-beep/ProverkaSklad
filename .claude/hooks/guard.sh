#!/usr/bin/env bash
set -uo pipefail
set -f

input="$(cat)"
input="$(printf '%s' "$input" | sed 's/\\"/ /g')"
cmd="$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')"
[ -z "$cmd" ] && exit 0

block() {
  printf '%s\n' "$1" >&2
  exit 2
}

case "$cmd" in
  *"git push"*" main"*|*"git push"*":main"*) block "Заблокирован прямой push в main. Создайте рабочую ветку и PR." ;;
  *"push"*"--force"*|*"push -f"*|*"reset --hard"*) block "Заблокирована перезапись истории Git." ;;
  *"rm -rf"*|*"rm -fr"*) block "Заблокировано рекурсивное удаление." ;;
esac

case "$cmd" in
  *"git push"*)
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [ "$branch" = "main" ] && block "Заблокирован push из ветки main."
    ;;
esac

exit 0
