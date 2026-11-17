Set fso = CreateObject("Scripting.FileSystemObject")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1Path = scriptsDir & "\wms-manager.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """ -Action start-silent"
CreateObject("WScript.Shell").Run cmd, 0, False
