param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing

function New-BrandIcon {
  param([string]$Path, [int]$Size)

  $scale = $Size / 512.0
  function S([double]$value) { [int][Math]::Round($value * $scale) }
  function FS([double]$value) { [single]($value * $scale) }

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $green = [System.Drawing.Color]::FromArgb(255, 6, 71, 47)
  $orange = [System.Drawing.Color]::FromArgb(255, 245, 132, 13)
  $yellow = [System.Drawing.Color]::FromArgb(255, 255, 199, 43)
  $leaf = [System.Drawing.Color]::FromArgb(255, 159, 211, 47)
  $dark = [System.Drawing.Color]::FromArgb(255, 4, 58, 40)
  $white = [System.Drawing.Color]::White

  $graphics.Clear($green)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($orange), (S 151), (S 52), (S 210), (S 210))
  $graphics.FillPie([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 82, 168, 47)), (S 151), (S 52), (S 210), (S 210), 90, 180)

  $graphics.TranslateTransform((S 243), (S 51))
  $graphics.RotateTransform(-27)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($leaf), (S -125), (S -55), (S 126), (S 58))
  $graphics.ResetTransform()
  $graphics.TranslateTransform((S 282), (S 49))
  $graphics.RotateTransform(22)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($leaf), 0, (S -56), (S 125), (S 59))
  $graphics.ResetTransform()

  $continent = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $continent.AddPolygon([System.Drawing.Point[]]@(
    [System.Drawing.Point]::new((S 228),(S 94)), [System.Drawing.Point]::new((S 270),(S 82)), [System.Drawing.Point]::new((S 292),(S 107)),
    [System.Drawing.Point]::new((S 275),(S 133)), [System.Drawing.Point]::new((S 307),(S 150)), [System.Drawing.Point]::new((S 296),(S 186)),
    [System.Drawing.Point]::new((S 265),(S 195)), [System.Drawing.Point]::new((S 245),(S 168)), [System.Drawing.Point]::new((S 215),(S 172)),
    [System.Drawing.Point]::new((S 201),(S 136))
  ))
  $graphics.FillPath([System.Drawing.SolidBrush]::new($dark), $continent)
  $graphics.FillEllipse([System.Drawing.SolidBrush]::new($dark), (S 185), (S 168), (S 60), (S 49))

  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $fontFamily = 'Segoe UI'
  $fontFrutos = [System.Drawing.Font]::new($fontFamily, (FS 47), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fontTropicales = [System.Drawing.Font]::new($fontFamily, (FS 42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fontPeru = [System.Drawing.Font]::new($fontFamily, (FS 42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.DrawString('FRUTOS', $fontFrutos, [System.Drawing.SolidBrush]::new($white), [System.Drawing.RectangleF]::new(0, (FS 295), $Size, (FS 55)), $format)
  $graphics.DrawString('TROPICALES', $fontTropicales, [System.Drawing.SolidBrush]::new($white), [System.Drawing.RectangleF]::new(0, (FS 351), $Size, (FS 55)), $format)
  $graphics.DrawString('PERÚ', $fontPeru, [System.Drawing.SolidBrush]::new($yellow), [System.Drawing.RectangleF]::new(0, (FS 418), $Size, (FS 50)), $format)
  $graphics.DrawLine([System.Drawing.Pen]::new($orange, (FS 5)), (S 161), (S 476), (S 351), (S 476))

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $fontFrutos.Dispose(); $fontTropicales.Dispose(); $fontPeru.Dispose(); $format.Dispose(); $continent.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

$pwaTargets = @(
  @{ File = 'public/icons/frutos-tropicales-logo.png'; Size = 512 },
  @{ File = 'public/icons/frutos-tropicales-512.png'; Size = 512 },
  @{ File = 'public/icons/frutos-tropicales-192.png'; Size = 192 },
  @{ File = 'public/icons/frutos-tropicales-180.png'; Size = 180 },
  @{ File = 'public/icons/frutos-tropicales.png'; Size = 192 },
  @{ File = 'public/icons/rutacontrol-512.png'; Size = 512 },
  @{ File = 'public/icons/rutacontrol-192.png'; Size = 192 },
  @{ File = 'public/icons/rutacontrol-180.png'; Size = 180 },
  @{ File = 'resources/icon.png'; Size = 512 }
)

foreach ($target in $pwaTargets) {
  New-BrandIcon -Path (Join-Path $ProjectRoot $target.File) -Size $target.Size
}

$androidLauncherDirectories = Get-ChildItem (Join-Path $ProjectRoot 'android/app/src/main/res') -Directory | Where-Object { $_.Name -like 'mipmap-*' }
foreach ($directory in $androidLauncherDirectories) {
  foreach ($fileName in @('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png')) {
    New-BrandIcon -Path (Join-Path $directory.FullName $fileName) -Size 512
  }
}

Write-Output 'Íconos de Frutos Tropicales Perú generados.'
