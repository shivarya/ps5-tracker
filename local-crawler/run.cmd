@echo off
cd /d "%~dp0"
node index.js >> logs\crawler.log 2>&1
