@echo off
chcp 65001 >nul
title DSH 跑图
cd /d "%~dp0"
echo ComfyUI 没开也没关系，会自动拉起。看门狗守夜，卡死自动重启。
echo.
set /p MODE=继续上次中断的批次？(Y=续跑，直接回车=跑新一批): 
if /i "%MODE%"=="Y" (
  node runner.mjs --resume --keep-going
) else (
  set /p N=跑几张？（直接回车 = 50）: 
  if "%N%"=="" set N=50
  node runner.mjs --n %N% --keep-going
)
echo.
echo ================================================================
echo 跑完了。图在 runs\\images\\ 目录，记录在 runs\\runs.json
echo ================================================================
pause
