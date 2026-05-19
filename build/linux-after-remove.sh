#!/bin/bash
# Clawd on Desk — Linux deb afterRemove script
# Called by dpkg/apt when the package is removed (dpkg -r / apt remove).
# Enumerates real user home directories and removes Clawd hook entries from
# all supported agent config files.
#
# Exit 0 unconditionally — uninstall must never fail due to hook cleanup.

set -e
trap 'exit 0' ERR

# Markers used to identify Clawd-owned hooks
CLAWD_MARKERS=("clawd-hook.js" "codebuddy-hook.js" "gemini-hook.js" "cursor-hook.js" "kiro-hook.js" "kimi-hook.js" "copilot-hook.js" "codex-hook.js" "auto-start.js" "auto-start.sh" "opencode-plugin" "openclaw-plugin" "hermes-plugin")

# Remove Clawd entries from a JSON settings file (hooks object with arrays)
# Uses python3/python as a portable JSON processor (available on all deb systems)
remove_clawd_from_json_settings() {
  local file="$1"
  [ -f "$file" ] || return 0

  local python_bin=""
  if command -v python3 &>/dev/null; then
    python_bin="python3"
  elif command -v python &>/dev/null; then
    python_bin="python"
  else
    # No python available — skip JSON cleanup
    return 0
  fi

  "$python_bin" - "$file" "${CLAWD_MARKERS[@]}" <<'PYTHON_SCRIPT'
import json
import sys
import os
import shutil
from datetime import datetime

config_path = sys.argv[1]
markers = sys.argv[2:]

try:
    with open(config_path, 'r', encoding='utf-8') as f:
        settings = json.load(f)
except (IOError, json.JSONDecodeError):
    sys.exit(0)

if not isinstance(settings, dict):
    sys.exit(0)

hooks = settings.get('hooks')
if not isinstance(hooks, dict):
    # Also check 'plugin' array (opencode)
    plugin = settings.get('plugin')
    if isinstance(plugin, list):
        new_plugin = [p for p in plugin if not any(m in str(p) for m in markers)]
        if len(new_plugin) != len(plugin):
            settings['plugin'] = new_plugin
            backup = config_path + '.clawd-uninstall-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak'
            shutil.copy2(config_path, backup)
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
                f.write('\n')
    sys.exit(0)

def has_marker(value):
    if not isinstance(value, str):
        return False
    return any(m in value for m in markers)

def is_clawd_http_hook(hook):
    if not isinstance(hook, dict):
        return False
    if hook.get('type') != 'http':
        return False
    url = hook.get('url', '')
    return '127.0.0.1' in url and '/permission' in url

changed = False
events_to_delete = []

for event, entries in list(hooks.items()):
    if not isinstance(entries, list):
        continue
    new_entries = []
    for entry in entries:
        if not isinstance(entry, dict):
            new_entries.append(entry)
            continue
        # Check flat command
        cmd = entry.get('command', '')
        if has_marker(cmd):
            changed = True
            continue
        # Check bash/powershell (copilot format)
        bash_cmd = entry.get('bash', '')
        ps_cmd = entry.get('powershell', '')
        if has_marker(bash_cmd) or has_marker(ps_cmd):
            changed = True
            continue
        # Check HTTP hook
        if is_clawd_http_hook(entry):
            changed = True
            continue
        # Check nested hooks array
        inner_hooks = entry.get('hooks')
        if isinstance(inner_hooks, list):
            new_inner = []
            for h in inner_hooks:
                if not isinstance(h, dict):
                    new_inner.append(h)
                    continue
                h_cmd = h.get('command', '')
                if has_marker(h_cmd):
                    changed = True
                    continue
                if is_clawd_http_hook(h):
                    changed = True
                    continue
                new_inner.append(h)
            if len(new_inner) != len(inner_hooks):
                changed = True
            if new_inner:
                entry['hooks'] = new_inner
                new_entries.append(entry)
            else:
                changed = True
            continue
        new_entries.append(entry)
    if new_entries:
        hooks[event] = new_entries
    else:
        events_to_delete.append(event)
        changed = True

for event in events_to_delete:
    del hooks[event]

# Also clean hooksConfig.disabled (gemini)
hooks_config = settings.get('hooksConfig')
if isinstance(hooks_config, dict):
    disabled = hooks_config.get('disabled')
    if isinstance(disabled, list):
        new_disabled = [d for d in disabled if d != 'clawd' and not has_marker(str(d))]
        if len(new_disabled) != len(disabled):
            hooks_config['disabled'] = new_disabled
            changed = True

if not changed:
    sys.exit(0)

# Backup and write
backup = config_path + '.clawd-uninstall-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak'
shutil.copy2(config_path, backup)
with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write('\n')
PYTHON_SCRIPT
}

# Remove Clawd [[hooks]] blocks from a TOML file (kimi config.toml)
remove_clawd_from_toml() {
  local file="$1"
  [ -f "$file" ] || return 0

  # Check if any marker exists in the file first
  local found=0
  for marker in "${CLAWD_MARKERS[@]}"; do
    if grep -q "$marker" "$file" 2>/dev/null; then
      found=1
      break
    fi
  done
  [ "$found" -eq 1 ] || return 0

  local backup="${file}.clawd-uninstall-$(date +%Y%m%d-%H%M%S).bak"
  cp "$file" "$backup"

  # Use sed to remove [[hooks]] blocks containing markers
  # Strategy: use awk to identify and skip blocks
  local tmpfile
  tmpfile=$(mktemp)

  awk -v markers="${CLAWD_MARKERS[*]}" '
  BEGIN {
    split(markers, m, " ")
    in_block = 0
    block = ""
    skip_block = 0
  }
  /^\s*\[\[hooks\]\]/ {
    if (in_block && !skip_block) {
      printf "%s", block
    }
    in_block = 1
    block = $0 "\n"
    skip_block = 0
    next
  }
  /^\s*\[/ {
    if (in_block) {
      if (!skip_block) {
        printf "%s", block
      }
      in_block = 0
      block = ""
      skip_block = 0
    }
    print
    next
  }
  {
    if (in_block) {
      block = block $0 "\n"
      for (i in m) {
        if (index($0, m[i]) > 0) {
          skip_block = 1
          break
        }
      }
    } else {
      print
    }
  }
  END {
    if (in_block && !skip_block) {
      printf "%s", block
    }
  }
  ' "$file" > "$tmpfile"

  # Clean up excessive blank lines
  sed -i '/^$/N;/^\n$/d' "$tmpfile" 2>/dev/null || true
  mv "$tmpfile" "$file"
}

# Remove Clawd hooks from Kiro agent JSON files
remove_clawd_from_kiro_agents() {
  local agents_dir="$1"
  [ -d "$agents_dir" ] || return 0

  for agent_file in "$agents_dir"/*.json; do
    [ -f "$agent_file" ] || continue
    remove_clawd_from_json_settings "$agent_file"
  done
}

# Main: enumerate all real user home directories
enumerate_user_homes() {
  # Get users with UID >= 1000 and < 60000 (real users on most distros)
  if [ -f /etc/passwd ]; then
    awk -F: '$3 >= 1000 && $3 < 60000 { print $6 }' /etc/passwd
  fi
  # Also try the current SUDO_USER's home if running under sudo
  if [ -n "$SUDO_USER" ]; then
    eval echo "~$SUDO_USER" 2>/dev/null || true
  fi
}

# Process a single user's home directory
process_user_home() {
  local home="$1"
  [ -d "$home" ] || return 0

  # Claude Code: ~/.claude/settings.json
  remove_clawd_from_json_settings "$home/.claude/settings.json"

  # CodeBuddy: ~/.codebuddy/settings.json
  remove_clawd_from_json_settings "$home/.codebuddy/settings.json"

  # Gemini CLI: ~/.gemini/settings.json
  remove_clawd_from_json_settings "$home/.gemini/settings.json"

  # Cursor Agent: ~/.cursor/hooks.json
  remove_clawd_from_json_settings "$home/.cursor/hooks.json"

  # Kiro CLI: ~/.kiro/agents/*.json
  remove_clawd_from_kiro_agents "$home/.kiro/agents"

  # Kimi CLI: ~/.kimi/config.toml
  remove_clawd_from_toml "$home/.kimi/config.toml"

  # Copilot CLI: ~/.copilot/hooks/hooks.json
  remove_clawd_from_json_settings "$home/.copilot/hooks/hooks.json"

  # Codex CLI: ~/.codex/settings.json
  remove_clawd_from_json_settings "$home/.codex/settings.json"

  # OpenCode: ~/.config/opencode/opencode.json
  remove_clawd_from_json_settings "$home/.config/opencode/opencode.json"

  # OpenClaw: ~/.config/openclaw/config.json (if applicable)
  remove_clawd_from_json_settings "$home/.config/openclaw/config.json"

  # Pi Extension: ~/.pi/settings.json (if applicable)
  remove_clawd_from_json_settings "$home/.pi/settings.json"
}

# Deduplicate home directories and process each
declare -A seen_homes
while IFS= read -r home; do
  [ -z "$home" ] && continue
  [ -d "$home" ] || continue
  # Normalize
  home=$(realpath "$home" 2>/dev/null || echo "$home")
  [ -n "${seen_homes[$home]+x}" ] && continue
  seen_homes[$home]=1
  process_user_home "$home"
done < <(enumerate_user_homes)

exit 0
