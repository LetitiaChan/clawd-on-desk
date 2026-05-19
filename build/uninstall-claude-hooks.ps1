param(
  [string]$InstallDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
$ClawdPermissionPorts = @(23333, 23334, 23335, 23336, 23337)
$ClawdCommandMarkers = @(
  "clawd-hook.js",
  "auto-start.js",
  "auto-start.sh",
  "codebuddy-hook.js",
  "gemini-hook.js",
  "cursor-hook.js",
  "kiro-hook.js",
  "kimi-hook.js",
  "copilot-hook.js",
  "codex-hook.js",
  "codex-debug-hook.js",
  "openclaw-plugin",
  "opencode-plugin",
  "hermes-plugin"
)

function Normalize-PathForCompare {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
  try {
    $fullPath = [System.IO.Path]::GetFullPath($PathValue.Trim().Trim('"'))
    $fullPath = $fullPath.Replace("/", "\")
    return ($fullPath -replace "\\+$", "").ToLowerInvariant()
  } catch {
    return $null
  }
}

function Resolve-PlausibleUserHome {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }

  $candidate = $PathValue.Trim().Trim('"')
  if (-not [System.IO.Path]::IsPathRooted($candidate)) { return $null }
  if (-not [System.IO.Directory]::Exists($candidate)) { return $null }

  $normalized = Normalize-PathForCompare $candidate
  if ([string]::IsNullOrWhiteSpace($normalized)) { return $null }

  $blockedRoots = @($env:SystemRoot, $env:windir)
  foreach ($blockedRoot in $blockedRoots) {
    $blocked = Normalize-PathForCompare $blockedRoot
    if ([string]::IsNullOrWhiteSpace($blocked)) { continue }
    if ($normalized -eq $blocked -or $normalized.StartsWith($blocked + "\")) { return $null }
  }

  if ($normalized -match "\\(systemprofile|localservice|networkservice)$") { return $null }
  if ($normalized -match "\\serviceprofiles\\(localservice|networkservice)$") { return $null }

  return [System.IO.Path]::GetFullPath($candidate)
}

function Test-ProcessElevated {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Read-TrimmedTextCandidates {
  param([string]$PathValue)
  $values = New-Object System.Collections.ArrayList
  $encodings = @($Utf8NoBom, [System.Text.Encoding]::Unicode, [System.Text.Encoding]::Default)

  foreach ($encoding in $encodings) {
    try {
      $value = [System.IO.File]::ReadAllText($PathValue, $encoding)
      if ([string]::IsNullOrWhiteSpace($value)) { continue }
      [void]$values.Add($value.TrimStart([char]0xFEFF).Trim())
    } catch {
    }
  }

  return [object[]]$values.ToArray()
}

function Resolve-TargetUserHome {
  $markerPath = Join-Path $InstallDir ".clawd-install-user-home"
  if ([System.IO.File]::Exists($markerPath)) {
    foreach ($candidateText in (Read-TrimmedTextCandidates $markerPath)) {
      $resolved = Resolve-PlausibleUserHome $candidateText
      if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
    }
  }

  if (-not (Test-ProcessElevated)) {
    return Resolve-PlausibleUserHome $env:USERPROFILE
  }

  return $null
}

function Get-JsonProperty {
  param(
    [object]$ObjectValue,
    [string]$Name
  )

  if ($null -eq $ObjectValue -or $null -eq $ObjectValue.PSObject) { return $null }
  $matches = $ObjectValue.PSObject.Properties.Match($Name)
  if ($matches.Count -eq 0) { return $null }
  return $matches[0]
}

function Get-StringPropertyValue {
  param(
    [object]$ObjectValue,
    [string]$Name
  )

  $property = Get-JsonProperty $ObjectValue $Name
  if ($null -eq $property -or -not ($property.Value -is [string])) { return $null }
  return $property.Value
}

function Test-ClawdCommand {
  param([string]$Command)
  if ([string]::IsNullOrWhiteSpace($Command)) { return $false }

  foreach ($marker in $ClawdCommandMarkers) {
    if ($Command.IndexOf($marker, [System.StringComparison]::Ordinal) -ge 0) {
      return $true
    }
  }

  return $false
}

function Test-ClawdPermissionUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return $false }

  try {
    $uri = [System.Uri]$Url
    return $uri.IsAbsoluteUri `
      -and $uri.Scheme -eq "http" `
      -and $uri.Host -eq "127.0.0.1" `
      -and $uri.AbsolutePath -eq "/permission" `
      -and [string]::IsNullOrEmpty($uri.Query) `
      -and [string]::IsNullOrEmpty($uri.Fragment) `
      -and [string]::IsNullOrEmpty($uri.UserInfo) `
      -and ($ClawdPermissionPorts -contains $uri.Port)
  } catch {
    return $false
  }
}

function Test-ClawdHttpHook {
  param([object]$Hook)

  $type = Get-StringPropertyValue $Hook "type"
  if ($type -ne "http") { return $false }

  $url = Get-StringPropertyValue $Hook "url"
  return Test-ClawdPermissionUrl $url
}

function Remove-ClawdHooksFromEntries {
  param([object[]]$Entries)

  $nextEntries = New-Object System.Collections.ArrayList
  $removed = 0
  $changed = $false

  foreach ($entry in $Entries) {
    if ($null -eq $entry -or $null -eq $entry.PSObject) {
      [void]$nextEntries.Add($entry)
      continue
    }

    $entryCommand = Get-StringPropertyValue $entry "command"
    if (Test-ClawdCommand $entryCommand) {
      $removed++
      $changed = $true
      continue
    }

    if (Test-ClawdHttpHook $entry) {
      $removed++
      $changed = $true
      continue
    }

    # Check bash/powershell fields (Copilot CLI format)
    $bashCmd = Get-StringPropertyValue $entry "bash"
    $psCmd = Get-StringPropertyValue $entry "powershell"
    if ((Test-ClawdCommand $bashCmd) -or (Test-ClawdCommand $psCmd)) {
      $removed++
      $changed = $true
      continue
    }

    $hooksProperty = Get-JsonProperty $entry "hooks"
    if ($null -eq $hooksProperty -or -not ($hooksProperty.Value -is [System.Array])) {
      [void]$nextEntries.Add($entry)
      continue
    }

    $nextHooks = New-Object System.Collections.ArrayList
    $entryHooksChanged = $false

    foreach ($hook in ([object[]]$hooksProperty.Value)) {
      $removeHook = $false
      if ($null -ne $hook -and $null -ne $hook.PSObject) {
        $hookCommand = Get-StringPropertyValue $hook "command"
        if (Test-ClawdCommand $hookCommand) {
          $removeHook = $true
        } elseif (Test-ClawdHttpHook $hook) {
          $removeHook = $true
        }
      }

      if ($removeHook) {
        $removed++
        $changed = $true
        $entryHooksChanged = $true
      } else {
        [void]$nextHooks.Add($hook)
      }
    }

    if ($entryHooksChanged) {
      $nextHookArray = [object[]]$nextHooks.ToArray()
      $entryType = Get-StringPropertyValue $entry "type"
      if ($nextHookArray.Count -eq 0 -and [string]::IsNullOrEmpty($entryCommand) -and $entryType -ne "http") {
        continue
      }
      $hooksProperty.Value = [object[]]$nextHookArray
    }

    [void]$nextEntries.Add($entry)
  }

  return [pscustomobject]@{
    Entries = [object[]]$nextEntries.ToArray()
    Removed = $removed
    Changed = $changed
  }
}

function Remove-ClawdHooksFromSettings {
  param([object]$Settings)

  $hooksProperty = Get-JsonProperty $Settings "hooks"
  if ($null -eq $hooksProperty -or $null -eq $hooksProperty.Value -or $null -eq $hooksProperty.Value.PSObject) {
    return $false
  }

  $changed = $false
  $eventProperties = @($hooksProperty.Value.PSObject.Properties)

  foreach ($eventProperty in $eventProperties) {
    if (-not ($eventProperty.Value -is [System.Array])) { continue }

    $result = Remove-ClawdHooksFromEntries -Entries ([object[]]$eventProperty.Value)
    if (-not $result.Changed) { continue }

    $changed = $true
    $nextEntries = [object[]]$result.Entries
    if ($nextEntries.Count -gt 0) {
      $eventProperty.Value = [object[]]$nextEntries
    } else {
      $hooksProperty.Value.PSObject.Properties.Remove($eventProperty.Name)
    }
  }

  return $changed
}

function Remove-ClawdFromPluginArray {
  param([object]$Settings)

  $pluginProperty = Get-JsonProperty $Settings "plugin"
  if ($null -eq $pluginProperty -or -not ($pluginProperty.Value -is [System.Array])) {
    return $false
  }

  $nextPlugins = New-Object System.Collections.ArrayList
  $changed = $false

  foreach ($entry in $pluginProperty.Value) {
    if ($entry -is [string] -and (Test-ClawdCommand $entry)) {
      $changed = $true
      continue
    }
    [void]$nextPlugins.Add($entry)
  }

  if ($changed) {
    $pluginProperty.Value = [object[]]$nextPlugins.ToArray()
  }

  return $changed
}

function Remove-ClawdFromKimiToml {
  param([string]$FilePath)

  if (-not [System.IO.File]::Exists($FilePath)) { return $false }

  $content = [System.IO.File]::ReadAllText($FilePath, $Utf8NoBom)
  if ([string]::IsNullOrWhiteSpace($content)) { return $false }

  $hasMarker = $false
  foreach ($marker in $ClawdCommandMarkers) {
    if ($content.IndexOf($marker, [System.StringComparison]::Ordinal) -ge 0) {
      $hasMarker = $true
      break
    }
  }
  if (-not $hasMarker) { return $false }

  # Line-by-line removal of [[hooks]] blocks containing Clawd markers
  $lines = $content -split "`n"
  $output = New-Object System.Collections.ArrayList
  $i = 0
  $removed = $false

  while ($i -lt $lines.Count) {
    $line = $lines[$i]
    if ($line -match '^\s*\[\[hooks\]\]') {
      $blockStart = $i
      $j = $i + 1
      while ($j -lt $lines.Count -and $lines[$j] -notmatch '^\s*\[\[?[^\]]+\]\]?') {
        $j++
      }
      $block = ($lines[$blockStart..($j-1)]) -join "`n"
      $blockHasMarker = $false
      foreach ($marker in $ClawdCommandMarkers) {
        if ($block.IndexOf($marker, [System.StringComparison]::Ordinal) -ge 0) {
          $blockHasMarker = $true
          break
        }
      }
      if ($blockHasMarker) {
        $removed = $true
      } else {
        for ($k = $blockStart; $k -lt $j; $k++) {
          [void]$output.Add($lines[$k])
        }
      }
      $i = $j
    } else {
      [void]$output.Add($line)
      $i++
    }
  }

  if ($removed) {
    $newContent = ($output.ToArray() -join "`n") -replace "(`n){3,}", "`n`n"
    $newContent = $newContent.TrimEnd() + "`n"
    [System.IO.File]::WriteAllText($FilePath, $newContent, $Utf8NoBom)
  }

  return $removed
}

function Remove-ClawdFromKiroAgents {
  param([string]$AgentsDir)

  if (-not [System.IO.Directory]::Exists($AgentsDir)) { return $false }

  $changed = $false
  $jsonFiles = Get-ChildItem -Path $AgentsDir -Filter "*.json" -File -ErrorAction SilentlyContinue

  foreach ($file in $jsonFiles) {
    try {
      $raw = [System.IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
      $settings = ConvertFrom-Json -InputObject $raw
      if ($null -eq $settings) { continue }

      if (Remove-ClawdHooksFromSettings $settings) {
        $json = ConvertTo-Json -InputObject $settings -Depth 100
        [System.IO.File]::WriteAllText($file.FullName, $json + [Environment]::NewLine, $Utf8NoBom)
        $changed = $true
      }
    } catch {
      continue
    }
  }

  return $changed
}

function Process-JsonSettingsFile {
  param(
    [string]$FilePath,
    [string]$AgentName,
    [switch]$IsPluginArray
  )

  if (-not [System.IO.File]::Exists($FilePath)) { return }

  try {
    $rawSettings = [System.IO.File]::ReadAllText($FilePath, $Utf8NoBom)
    $rawSettings = $rawSettings.TrimStart([char]0xFEFF)
    $settings = ConvertFrom-Json -InputObject $rawSettings
    if ($null -eq $settings) { return }

    $changed = $false
    if ($IsPluginArray) {
      $changed = Remove-ClawdFromPluginArray $settings
    } else {
      $changed = Remove-ClawdHooksFromSettings $settings
    }

    if (-not $changed) { return }

    $backupName = "{0}.clawd-uninstall-{1}.bak" -f (Split-Path -Leaf $FilePath), (Get-Date -Format "yyyyMMdd-HHmmss-fff")
    $backupPath = Join-Path (Split-Path -Parent $FilePath) $backupName
    [System.IO.File]::Copy($FilePath, $backupPath, $false)

    $json = ConvertTo-Json -InputObject $settings -Depth 100
    [System.IO.File]::WriteAllText($FilePath, $json + [Environment]::NewLine, $Utf8NoBom)
  } catch {
  }
}

try {
  $userHome = Resolve-TargetUserHome
  if ([string]::IsNullOrWhiteSpace($userHome)) { exit 0 }

  # --- Claude Code ---
  Process-JsonSettingsFile -FilePath (Join-Path (Join-Path $userHome ".claude") "settings.json") -AgentName "Claude"

  # --- CodeBuddy ---
  Process-JsonSettingsFile -FilePath (Join-Path (Join-Path $userHome ".codebuddy") "settings.json") -AgentName "CodeBuddy"

  # --- Gemini CLI ---
  Process-JsonSettingsFile -FilePath (Join-Path (Join-Path $userHome ".gemini") "settings.json") -AgentName "Gemini"

  # --- Cursor Agent ---
  Process-JsonSettingsFile -FilePath (Join-Path (Join-Path $userHome ".cursor") "hooks.json") -AgentName "Cursor"

  # --- Copilot CLI ---
  $copilotHooksPath = Join-Path $userHome ".copilot"
  $copilotHooksPath = Join-Path $copilotHooksPath "hooks"
  $copilotHooksPath = Join-Path $copilotHooksPath "hooks.json"
  Process-JsonSettingsFile -FilePath $copilotHooksPath -AgentName "Copilot"

  # --- Codex CLI ---
  Process-JsonSettingsFile -FilePath (Join-Path (Join-Path $userHome ".codex") "hooks.json") -AgentName "Codex"

  # --- Kiro CLI (per-agent JSON files) ---
  $kiroAgentsDir = Join-Path (Join-Path $userHome ".kiro") "agents"
  Remove-ClawdFromKiroAgents -AgentsDir $kiroAgentsDir

  # --- Kimi CLI (TOML) ---
  $kimiConfigPath = Join-Path (Join-Path $userHome ".kimi") "config.toml"
  Remove-ClawdFromKimiToml -FilePath $kimiConfigPath

  # --- OpenCode (plugin array) ---
  $opencodeConfigPath = Join-Path $userHome ".config"
  $opencodeConfigPath = Join-Path $opencodeConfigPath "opencode"
  $opencodeConfigPath = Join-Path $opencodeConfigPath "opencode.json"
  Process-JsonSettingsFile -FilePath $opencodeConfigPath -AgentName "OpenCode" -IsPluginArray

  # --- OpenClaw (plugin registration in ~/.openclaw/) ---
  $openclawConfigPath = Join-Path (Join-Path $userHome ".openclaw") "plugins.json"
  Process-JsonSettingsFile -FilePath $openclawConfigPath -AgentName "OpenClaw" -IsPluginArray

  # --- Hermes (plugin registration) ---
  $hermesConfigPath = Join-Path (Join-Path $userHome ".hermes") "plugins.json"
  Process-JsonSettingsFile -FilePath $hermesConfigPath -AgentName "Hermes" -IsPluginArray

  # --- Pi Extension ---
  $piConfigPath = Join-Path (Join-Path $userHome ".pi") "extensions.json"
  Process-JsonSettingsFile -FilePath $piConfigPath -AgentName "Pi" -IsPluginArray

  exit 0
} catch {
  exit 0
}
