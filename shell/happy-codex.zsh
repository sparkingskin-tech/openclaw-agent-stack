happy_codex_bridge_root="/Users/skin/Projects/整理电脑"
happy_codex_bridge_script="$happy_codex_bridge_root/scripts/happy_codex_bridge.mjs"
happy_codex_remote_fix_script="$happy_codex_bridge_root/scripts/happy_codex_remote_fix.mjs"

alias codex-local="/opt/homebrew/bin/codex"
alias happy-codex-sync="node $happy_codex_bridge_script sync"
alias happy-codex-scan="node $happy_codex_bridge_script scan"
alias happy-codex-threads="node $happy_codex_bridge_script list threads"
alias happy-codex-projects="node $happy_codex_bridge_script list projects"

codex() {
  if [ "$#" -eq 0 ]; then
    node "$happy_codex_remote_fix_script"
    return $?
  fi
  /opt/homebrew/bin/codex "$@"
}

hcx() {
  if [ "$#" -lt 2 ]; then
    echo "Usage: hcx <thread|project> <key>" >&2
    return 1
  fi
  node "$happy_codex_bridge_script" launch "$1" "$2"
}
