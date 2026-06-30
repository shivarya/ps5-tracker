@echo off
cd /d "%~dp0"
node dashboard.js >> logs\dashboard.log 2>&1
