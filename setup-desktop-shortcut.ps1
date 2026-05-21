Add-Type -AssemblyName System.Drawing

$Dir       = $PSScriptRoot
$IconPath  = Join-Path $Dir 'food-tracker.ico'
$BatPath   = Join-Path $Dir 'launch-food-tracker.bat'
$LinkName  = 'Food Tracker.lnk'
$LinkPath  = Join-Path ([Environment]::GetFolderPath('Desktop')) $LinkName

# ---- Draw 256x256 icon: stylized grocery receipt ----
$size = 256
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'

# Background: deep teal-green rounded square
$bgRect = New-Object System.Drawing.Rectangle 4, 4, ($size - 8), ($size - 8)
$path   = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 32
$path.AddArc($bgRect.X,            $bgRect.Y,             $r*2, $r*2, 180, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Y,             $r*2, $r*2, 270, 90)
$path.AddArc($bgRect.Right - $r*2, $bgRect.Bottom - $r*2, $r*2, $r*2, 0,   90)
$path.AddArc($bgRect.X,            $bgRect.Bottom - $r*2, $r*2, $r*2, 90,  90)
$path.CloseFigure()

$bgColor     = [System.Drawing.Color]::FromArgb(255, 31, 59, 54)
$accentColor = [System.Drawing.Color]::FromArgb(255, 232, 178, 106)
$paperColor  = [System.Drawing.Color]::FromArgb(255, 245, 240, 230)
$lineColor   = [System.Drawing.Color]::FromArgb(255, 95, 95, 95)

$g.FillPath((New-Object System.Drawing.SolidBrush $bgColor), $path)
$g.DrawPath((New-Object System.Drawing.Pen $accentColor, 6), $path)

# Receipt body (rounded top, jagged bottom edge for the classic torn look)
$rcpW = 140
$rcpH = 160
$rcpX = [int](($size - $rcpW) / 2)
$rcpY = 50

$rcpPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$cr = 10
# Top rounded corners + flat sides
$rcpPath.AddArc($rcpX,                  $rcpY,                  $cr*2, $cr*2, 180, 90)
$rcpPath.AddArc($rcpX + $rcpW - $cr*2,  $rcpY,                  $cr*2, $cr*2, 270, 90)
$rcpPath.AddLine($rcpX + $rcpW, $rcpY + $cr, $rcpX + $rcpW, $rcpY + $rcpH - 14)

# Jagged bottom: 7 zigzag teeth
$teeth = 7
$toothW = $rcpW / $teeth
for ($i = 0; $i -lt $teeth; $i++) {
    $tipY = if ($i % 2 -eq 0) { $rcpY + $rcpH } else { $rcpY + $rcpH - 14 }
    $rcpPath.AddLine($rcpX + $rcpW - ($i * $toothW), $tipY, $rcpX + $rcpW - (($i + 1) * $toothW), $tipY)
}
$rcpPath.AddLine($rcpX, $rcpY + $rcpH - 14, $rcpX, $rcpY + $cr)
$rcpPath.CloseFigure()

$g.FillPath((New-Object System.Drawing.SolidBrush $paperColor), $rcpPath)

# Subtle shadow under receipt
$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
$g.FillRectangle($shadowBrush, $rcpX + 4, $rcpY + $rcpH + 4, $rcpW - 8, 6)

# Item lines inside receipt
$lineX = $rcpX + 18
$lineW = $rcpW - 36
$lineH = 9

# Header line (shorter, like vendor name)
$g.FillRectangle((New-Object System.Drawing.SolidBrush $lineColor), $lineX, $rcpY + 22, [int]($lineW * 0.55), $lineH)
# Line 1
$g.FillRectangle((New-Object System.Drawing.SolidBrush $lineColor), $lineX, $rcpY + 44, $lineW, $lineH)
# Line 2 (highlighted item - accent color)
$g.FillRectangle((New-Object System.Drawing.SolidBrush $accentColor), $lineX, $rcpY + 62, $lineW, $lineH)
# Line 3
$g.FillRectangle((New-Object System.Drawing.SolidBrush $lineColor), $lineX, $rcpY + 80, [int]($lineW * 0.85), $lineH)
# Line 4
$g.FillRectangle((New-Object System.Drawing.SolidBrush $lineColor), $lineX, $rcpY + 98, [int]($lineW * 0.75), $lineH)
# Total line (heavier, shorter)
$totalH = 13
$g.FillRectangle((New-Object System.Drawing.SolidBrush $lineColor), $lineX, $rcpY + 122, [int]($lineW * 0.45), $totalH)

$g.Dispose()

# ---- Wrap PNG into ICO ----
$ms  = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ms.Close()
$bmp.Dispose()

if (Test-Path $IconPath) { Remove-Item $IconPath -Force }
$fs = New-Object System.IO.FileStream $IconPath, 'Create'
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]1)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([uint16]1)
$bw.Write([uint16]32)
$bw.Write([uint32]$png.Length)
$bw.Write([uint32]22)
$bw.Write($png)
$bw.Close()
$fs.Close()

# ---- Build .lnk on Desktop ----
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($LinkPath)
$lnk.TargetPath       = $BatPath
$lnk.WorkingDirectory = $Dir
$lnk.IconLocation     = "$IconPath,0"
$lnk.Description      = 'Food Tracker - parse grocery receipts and track nutrition'
$lnk.WindowStyle      = 7
$lnk.Save()

Write-Host "[ok] Shortcut placed on Desktop: $LinkName"
Write-Host "     Target: $BatPath"
Write-Host "     Icon:   $IconPath"
