#!/bin/bash
# 3G Healthcare Atlas - property_master Load Script
# Run this from Git Bash or WSL in the docker directory

set -e

echo "=== 3G Healthcare Atlas - property_master Load ==="
echo ""

# Step 1: Start Docker
echo "[1/5] Starting Docker containers..."
docker-compose up -d
sleep 10

# Step 2: Wait for MySQL to be healthy
echo "[2/5] Waiting for MySQL to be healthy..."
until docker exec 3ghcre-mysql mysqladmin ping -h localhost -u root -pdevpass --silent; do
    echo "  Waiting..."
    sleep 3
done
echo "  MySQL is ready!"

# Step 3: Load CSV into staging
echo "[3/5] Loading CSV into staging table..."
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas --local-infile=1 < init/00_load_csv_staging.sql
echo "  CSV loaded!"

# Step 4: Transform to property_master
echo "[4/5] Loading property_master from staging..."
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas < init/02_load_property_master.sql
echo "  property_master loaded!"

# Step 5: Run validation
echo "[5/5] Running validation queries..."
docker exec -i 3ghcre-mysql mysql -u atlas_user -patlas_pass atlas < init/03_validation_queries.sql

echo ""
echo "=== Load Complete ==="
