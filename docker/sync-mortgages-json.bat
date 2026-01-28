@echo off
echo === Extracting Mortgages from raw_json ===
echo.

REM Copy the shell script into the container
docker cp "%~dp0sync-mortgages-json.sh" 3ghcre-mysql:/tmp/

REM Make it executable and run it
docker exec 3ghcre-mysql chmod +x /tmp/sync-mortgages-json.sh
docker exec 3ghcre-mysql bash /tmp/sync-mortgages-json.sh

pause
