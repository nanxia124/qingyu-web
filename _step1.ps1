$enc = New-Object Text.UTF8Encoding($false)
$files = Get-ChildItem -Path D:\qingyu-web\src\canvas -Recurse -Filter *.tsx
# 吃掉 shadow token + 它前面的一个空格；不碰换行、不碰缩进
$rx = [regex]'\s(?:hover:|dark:|focus:)?!?shadow-(?:sm|md|lg|xl|2xl)(?=\s|"|$)'
$changed = 0
foreach ($f in $files) {
  $orig = [IO.File]::ReadAllText($f.FullName)
  if (-not $rx.IsMatch($orig)) { continue }
  $new = $rx.Replace($orig, '')
  [IO.File]::WriteAllText($f.FullName, $new, $enc)
  $changed++
}
"shadow class removed from $changed files"
