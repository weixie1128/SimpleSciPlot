$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$port = 8787
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
$url = "http://127.0.0.1:$port/"
Write-Host "肉制品新鲜度实验助手已启动：$url"
Write-Host "关闭本窗口即可停止程序。"
Start-Process $url
$contentTypes = @{
  ".html"="text/html; charset=utf-8"; ".js"="application/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8";
  ".json"="application/json; charset=utf-8"; ".webmanifest"="application/manifest+json"; ".png"="image/png";
  ".xlsx"="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; ".xls"="application/vnd.ms-excel"; ".csv"="text/csv; charset=utf-8"
}
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 8192, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }
      while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") { }
      $parts = $requestLine.Split(' ')
      $rawPath = if ($parts.Length -ge 2) { $parts[1].Split('?')[0] } else { "/" }
      $path = [Uri]::UnescapeDataString($rawPath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
      $fullPath = [IO.Path]::GetFullPath((Join-Path $root $path))
      if (-not $fullPath.StartsWith($root) -or -not (Test-Path $fullPath -PathType Leaf)) {
        $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      } else {
        $body = [IO.File]::ReadAllBytes($fullPath)
        $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $type = if ($contentTypes.ContainsKey($ext)) { $contentTypes[$ext] } else { "application/octet-stream" }
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      }
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
      try {
        $stream.Write($headerBytes,0,$headerBytes.Length)
        $stream.Write($body,0,$body.Length)
        $stream.Flush()
      } catch [IO.IOException] {
        # 客户端已断开连接（如浏览器取消请求），忽略并继续处理下一个请求
      }
    } finally { $client.Close() }
  }
} finally { $listener.Stop() }
