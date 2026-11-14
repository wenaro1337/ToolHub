$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name Claude | Where-Object PackageFamilyName -eq 'Claude_pzs8sxrjxfjjc'


$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$state = Join-Path 'HKLM:\SOFTWARE\ToolHub\ClaudeExecuteGuard' $userSid.Value
$targets = @()
if ($package) {
    $targets += @{ Path = (Join-Path $package.InstallLocation 'app\claude.exe'); Sid = $userSid; Marker = 'Executable'; Rights = 'ExecuteFile' }
    $targets += @{ Path = (Join-Path $package.InstallLocation 'app\resources\cowork-svc.exe'); Sid = $systemSid; Marker = 'CoworkExecutable'; Rights = 'ExecuteFile' }
}
$targets += @{ Path = (Join-Path $env:USERPROFILE '.local\bin\claude.exe'); Sid = $userSid; Marker = 'NativeCli'; Rights = 'ExecuteFile' }
$targets += @{ Path = (Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\cli.js'); Sid = $userSid; Marker = 'NpmCli'; Rights = 'ReadData' }
foreach ($target in $targets) {
    $file = $target.Path
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { continue }

    $sid = $target.Sid
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $target.Rights, 'Deny')
    $acl = Get-Acl -LiteralPath $file
    $existing = $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
        Where-Object {
            $_.IdentityReference -eq $sid -and
            $_.AccessControlType -eq 'Deny' -and
            $_.FileSystemRights -eq $rule.FileSystemRights
        }
    $marker = (Get-ItemProperty -LiteralPath $state -Name $target.Marker -ErrorAction SilentlyContinue).($target.Marker)
    if ($env:TOOLHUB_EXECUTE_BLOCK -eq '1') {
        if (!(Test-Path -LiteralPath $state)) { New-Item -Path $state -Force | Out-Null }
        # Recover an exact ToolHub guard rule left behind by older builds.
        New-ItemProperty -LiteralPath $state -Name $target.Marker -Value $file -Force | Out-Null
        if (!$existing) {
            $acl.AddAccessRule($rule)
            Set-Acl -LiteralPath $file -AclObject $acl
        }
    } elseif ($marker -eq $file -and ($env:TOOLHUB_EXECUTE_BLOCK -eq '0' -or ($env:TOOLHUB_EXECUTE_BLOCK -eq 'desktop-launch' -and $target.Marker -in 'Executable','CoworkExecutable') -or ($env:TOOLHUB_EXECUTE_BLOCK -eq 'cli-launch' -and $target.Marker -in 'NativeCli','NpmCli'))) {
        if ($existing) {
            $existing | ForEach-Object { $acl.RemoveAccessRuleSpecific($_) }
            Set-Acl -LiteralPath $file -AclObject $acl
        }
        Remove-ItemProperty -LiteralPath $state -Name $target.Marker
    }
}
