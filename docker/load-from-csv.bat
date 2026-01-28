@echo off
echo === Loading Atlas from CSV Files ===
echo.

set SOURCE=c:\Users\MSuLL\dev\.projects\3GHCRE

echo [1/8] Copying CSV files to Docker container...
docker cp "%SOURCE%\SNF_Enrollments_2025.12.02.csv" 3ghcre-mysql:/tmp/
docker cp "%SOURCE%\SNF_All_Owners_2025.12.02.csv" 3ghcre-mysql:/tmp/
docker cp "%SOURCE%\SNF_CHOW_2025.10.01.csv" 3ghcre-mysql:/tmp/
docker cp "%SOURCE%\NH_ProviderInfo_Jan2026.csv" 3ghcre-mysql:/tmp/
echo   Files copied!

echo [2/8] Creating schema (00_create_schema.sql)...
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\00_create_schema.sql

echo [3/8] Loading CMS Enrollments staging...
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas --local-infile=1 -e "SET GLOBAL local_infile=1; TRUNCATE TABLE cms_enrollments_staging; LOAD DATA LOCAL INFILE '/tmp/SNF_Enrollments_2025.12.02.csv' INTO TABLE cms_enrollments_staging CHARACTER SET latin1 FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' LINES TERMINATED BY '\r\n' IGNORE 1 ROWS (enrollment_id, enrollment_state, provider_type_code, provider_type_text, npi, multiple_npi_flag, ccn, associate_id, organization_name, doing_business_as_name, incorporation_date, incorporation_state, organization_type_structure, organization_other_type_text, proprietary_nonprofit, nursing_home_provider_name, affiliation_entity_name, affiliation_entity_id, address_line_1, address_line_2, city, state, zip_code);"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "SELECT COUNT(*) as enrollments_loaded FROM cms_enrollments_staging;"

echo [4/8] Loading property_master (02_load_property_master.sql)...
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\02_load_property_master.sql

echo [5/8] Loading companies (04_phase1b_companies.sql)...
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\04_phase1b_companies.sql

echo [6/8] Loading CMS Owners staging and principals (05_phase1b_principals.sql)...
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "DROP TABLE IF EXISTS cms_owners_staging;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "CREATE TABLE cms_owners_staging (enrollment_id VARCHAR(50), associate_id VARCHAR(50), organization_name VARCHAR(500), associate_id_owner VARCHAR(50), type_owner VARCHAR(10), role_code_owner VARCHAR(10), role_text_owner VARCHAR(255), association_date_owner VARCHAR(50), first_name_owner VARCHAR(255), middle_name_owner VARCHAR(255), last_name_owner VARCHAR(255), title_owner VARCHAR(255), organization_name_owner VARCHAR(500), doing_business_as_name_owner VARCHAR(500), address_line_1_owner VARCHAR(500), address_line_2_owner VARCHAR(500), city_owner VARCHAR(100), state_owner VARCHAR(10), zip_code_owner VARCHAR(20), percentage_ownership VARCHAR(20), created_for_acquisition_owner VARCHAR(10), corporation_owner VARCHAR(10), llc_owner VARCHAR(10), medical_provider_supplier_owner VARCHAR(10), management_services_company_owner VARCHAR(10), medical_staffing_company_owner VARCHAR(10), holding_company_owner VARCHAR(10), investment_firm_owner VARCHAR(10), financial_institution_owner VARCHAR(10), consulting_firm_owner VARCHAR(10), for_profit_owner VARCHAR(10), non_profit_owner VARCHAR(10), private_equity_company_owner VARCHAR(10), reit_owner VARCHAR(10), chain_home_office_owner VARCHAR(10), trust_or_trustee_owner VARCHAR(10), other_type_owner VARCHAR(10), other_type_text_owner VARCHAR(500), parent_company_owner VARCHAR(10), owned_by_another_org_or_ind_owner VARCHAR(10), INDEX(enrollment_id), INDEX(associate_id), INDEX(associate_id_owner), INDEX(type_owner), INDEX(role_code_owner)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas --local-infile=1 -e "LOAD DATA LOCAL INFILE '/tmp/SNF_All_Owners_2025.12.02.csv' INTO TABLE cms_owners_staging CHARACTER SET latin1 FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' LINES TERMINATED BY '\r\n' IGNORE 1 ROWS;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "SELECT COUNT(*) as owners_loaded FROM cms_owners_staging;"
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\05_phase1b_principals.sql

echo [7/8] Loading deals schema and CHOW data (06, 07)...
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\06_deals_schema.sql
REM Load CHOW staging
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "DROP TABLE IF EXISTS cms_chow_staging;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "CREATE TABLE cms_chow_staging (ccn VARCHAR(20), chow_type_code VARCHAR(10), chow_type_text VARCHAR(100), effective_date VARCHAR(50), associate_id_buyer VARCHAR(50), organization_name_buyer VARCHAR(500), doing_business_as_name_buyer VARCHAR(500), associate_id_seller VARCHAR(50), organization_name_seller VARCHAR(500), doing_business_as_name_seller VARCHAR(500), enrollment_id_buyer VARCHAR(50), enrollment_id_seller VARCHAR(50), INDEX(ccn), INDEX(associate_id_buyer), INDEX(associate_id_seller)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas --local-infile=1 -e "LOAD DATA LOCAL INFILE '/tmp/SNF_CHOW_2025.10.01.csv' INTO TABLE cms_chow_staging CHARACTER SET latin1 FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' LINES TERMINATED BY '\r\n' IGNORE 1 ROWS;"
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "SELECT COUNT(*) as chow_loaded FROM cms_chow_staging;"
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\07_phase1b_chow.sql

echo [8/8] Loading entities and linking (08, 09, 10, 11, 12, 13, 14, 15)...
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\08_phase1b_entities.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\09_phase1b_principal_entity.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\10_phase1b_validation.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\11_phase1b_standalone_entities.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\12_consolidate_standalone_portfolios.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\13_fix_principal_company_links.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\14_fix_deals_entity_links.sql
docker exec -i 3ghcre-mysql mysql -uroot -pdevpass atlas < init\15_historical_entities.sql

echo.
echo === Final Counts ===
docker exec 3ghcre-mysql mysql -uroot -pdevpass atlas -e "SELECT 'property_master' as tbl, COUNT(*) as cnt FROM property_master UNION ALL SELECT 'companies', COUNT(*) FROM companies UNION ALL SELECT 'entities', COUNT(*) FROM entities UNION ALL SELECT 'principals', COUNT(*) FROM principals UNION ALL SELECT 'deals', COUNT(*) FROM deals;"

pause
