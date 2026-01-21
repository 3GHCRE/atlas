-- Rate History Tracking Views
-- Created: 2026-01-20
-- Purpose: Enable period-over-period rate comparison and trend analysis

-- Drop existing views
DROP VIEW IF EXISTS v_rate_history;
DROP VIEW IF EXISTS v_rate_changes;
DROP VIEW IF EXISTS v_state_rate_trends;
DROP VIEW IF EXISTS v_rate_summary;

-- View: All rate history with facility details
CREATE VIEW v_rate_history AS
SELECT
    mr.id,
    mr.state,
    mr.facility_name,
    mr.property_master_id,
    mr.daily_rate,
    mr.effective_date,
    mr.end_date,
    mr.rate_period,
    mr.source_file,
    pm.city,
    pm.ccn
FROM medicaid_rates mr
LEFT JOIN property_master pm ON mr.property_master_id = pm.id
ORDER BY mr.state, mr.facility_name, mr.effective_date DESC;

-- View: Period-over-period rate changes per facility
-- Shows current vs prior period with dollar and percentage change
CREATE VIEW v_rate_changes AS
WITH ranked_rates AS (
    SELECT
        state,
        facility_name,
        property_master_id,
        daily_rate,
        effective_date,
        ROW_NUMBER() OVER (PARTITION BY state, facility_name ORDER BY effective_date DESC) as rn
    FROM medicaid_rates
),
current_rates AS (
    SELECT * FROM ranked_rates WHERE rn = 1
),
prior_rates AS (
    SELECT * FROM ranked_rates WHERE rn = 2
)
SELECT
    c.state,
    c.facility_name,
    c.property_master_id,
    c.daily_rate as current_rate,
    c.effective_date as current_period,
    p.daily_rate as prior_rate,
    p.effective_date as prior_period,
    ROUND(c.daily_rate - COALESCE(p.daily_rate, c.daily_rate), 2) as rate_change_dollar,
    ROUND((c.daily_rate - COALESCE(p.daily_rate, c.daily_rate)) / COALESCE(p.daily_rate, c.daily_rate) * 100, 2) as rate_change_pct
FROM current_rates c
LEFT JOIN prior_rates p ON c.state = p.state AND c.facility_name = p.facility_name;

-- View: State-level rate trends by period
CREATE VIEW v_state_rate_trends AS
SELECT
    state,
    effective_date,
    COUNT(*) as facility_count,
    ROUND(MIN(daily_rate), 2) as min_rate,
    ROUND(AVG(daily_rate), 2) as avg_rate,
    ROUND(MAX(daily_rate), 2) as max_rate,
    ROUND(STDDEV(daily_rate), 2) as std_dev
FROM medicaid_rates
WHERE daily_rate > 0
GROUP BY state, effective_date
ORDER BY state, effective_date DESC;

-- View: Current rate summary with history flag
CREATE VIEW v_rate_summary AS
SELECT
    mr.state,
    mr.facility_name,
    mr.property_master_id,
    mr.daily_rate,
    mr.effective_date,
    ROUND(mr.daily_rate * 365, 0) as annual_per_bed,
    pm.city,
    pm.ccn,
    (SELECT COUNT(*) FROM medicaid_rates mr2
     WHERE mr2.state = mr.state
     AND mr2.facility_name = mr.facility_name) as total_periods
FROM medicaid_rates mr
LEFT JOIN property_master pm ON mr.property_master_id = pm.id
WHERE mr.end_date IS NULL
ORDER BY mr.state, mr.daily_rate DESC;

-- Example queries for rate history analysis:

-- 1. Facilities with rate increases
-- SELECT * FROM v_rate_changes WHERE rate_change_pct > 0 ORDER BY rate_change_pct DESC;

-- 2. Facilities with rate decreases
-- SELECT * FROM v_rate_changes WHERE rate_change_pct < 0 ORDER BY rate_change_pct ASC;

-- 3. State average rate trend over time
-- SELECT * FROM v_state_rate_trends ORDER BY state, effective_date;

-- 4. Largest rate increases by dollar amount
-- SELECT * FROM v_rate_changes WHERE prior_rate IS NOT NULL ORDER BY rate_change_dollar DESC LIMIT 20;
