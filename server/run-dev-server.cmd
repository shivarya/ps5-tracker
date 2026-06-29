@echo off
cd /d "%~dp0"
php -S localhost:8000 >> ps5_tracker_dev_server.log 2>&1
