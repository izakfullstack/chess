@echo off
:loop
git add .
git commit -m "Auto-sync update"
git push origin main
timeout /t 60
goto loop