@echo off
cd /d "%~dp0"
php -S 0.0.0.0:8000 >> ps5_tracker_dev_server.log 2>&1
