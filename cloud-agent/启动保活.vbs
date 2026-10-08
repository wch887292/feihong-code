' 飞虹云中转保活启动器 · 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
' 由 Web 服务 /api/computer/nl 触发：wscript 短暂运行后退出，node 保活进程成为孤儿常驻
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"" ""H:\Muse Code复刻\dist\web\cloud-keepalive.js""", 0, False
