@echo off
REM 3G Healthcare Atlas - property_master Load Script
REM Run this from Command Prompt in the docker directory

echo === 3G Healthcare Atlas - property_master Load ===
echo.

echo [1/5] Starting Docker containers...
docker-compose up -d
timeout /t 10 /nobreak > nul

echo [2/5] Waiting for MySQL to be healthy...
:WAIT_LOOP
docker exec 3ghcre-mysql mysqladmin ping -h localhost -u root -pdevpass --silent > nul 2>&1
if errorlevel 1 (
    echo   Waiting...
    timeout /t 3 /nobreak > nul
    goto WAIT_LOOP
)
echo   MySQL is ready!

echo [3/5] Loading CSV into staging table...
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas --local-infile=1 < init\00_load_csv_staging.sql
echo   CSV loaded!

echo [4/5] Loading property_master from staging...
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas < init\02_load_property_master.sql
echo   property_master loaded!

echo [5/5] Running validation queries...
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas < init\03_validation_queries.sql

echo.
echo === Load Complete ===
pause
