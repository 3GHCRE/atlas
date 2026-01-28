#!/bin/bash
# run-full-audit.sh
# Master script to run the complete Atlas Database Validation Audit
#
# Usage: ./scripts/audit/run-full-audit.sh [--skip-baseline] [--batch N]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/data/audit"

echo "=============================================="
echo "ATLAS DATABASE VALIDATION AUDIT"
echo "=============================================="
echo "Started: $(date)"
echo "Output:  $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Parse arguments
SKIP_BASELINE=false
RUN_BATCH=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-baseline)
      SKIP_BASELINE=true
      shift
      ;;
    --batch)
      RUN_BATCH="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Function to run a script with timing
run_script() {
  local script=$1
  local name=$2

  echo ""
  echo "=============================================="
  echo "Running: $name"
  echo "=============================================="

  local start_time=$(date +%s)

  if node "$SCRIPT_DIR/$script" 2>&1 | tee -a "$OUTPUT_DIR/audit.log"; then
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo ""
    echo "✓ $name completed in ${duration}s"
  else
    echo ""
    echo "✗ $name FAILED"
    echo "Check $OUTPUT_DIR/audit.log for details"
    exit 1
  fi
}

# Run specific batch if requested
if [[ -n "$RUN_BATCH" ]]; then
  case $RUN_BATCH in
    0) run_script "00-baseline-integrity.js" "Baseline Integrity Checks" ;;
    1) run_script "01-validate-reits.js" "Batch 1: REIT Validation" ;;
    2) run_script "02-validate-nonprofits.js" "Batch 2: Nonprofit Validation" ;;
    3) run_script "03-validate-crm-enhanced.js" "Batch 3: CRM Junction Validation" ;;
    4) run_script "04-validate-cms-operators.js" "Batch 4: CMS Operator Validation" ;;
    5) run_script "05-validate-property-owners.js" "Batch 5: Property Owner Validation" ;;
    6) run_script "06-validate-principals.js" "Batch 6: Principal Validation" ;;
    7) run_script "07-validate-addresses.js" "Batch 7: Address Verification" ;;
    7b) run_script "07b-validate-reapi-addresses.js" "Batch 7b: REAPI Address Verification" ;;
    8) run_script "08-generate-audit-report.js" "Final Report Generation" ;;
    *)
      echo "Invalid batch number: $RUN_BATCH"
      echo "Valid batches: 0-8"
      exit 1
      ;;
  esac
  exit 0
fi

# Full audit run
echo "Running full audit..."
echo "" > "$OUTPUT_DIR/audit.log"

# Batch 0: Baseline
if [[ "$SKIP_BASELINE" != "true" ]]; then
  run_script "00-baseline-integrity.js" "Baseline Integrity Checks"
fi

# Batch 1: REITs
run_script "01-validate-reits.js" "Batch 1: REIT Validation"

# Batch 2: Nonprofits
run_script "02-validate-nonprofits.js" "Batch 2: Nonprofit Validation"

# Batch 3: CRM
run_script "03-validate-crm-enhanced.js" "Batch 3: CRM Junction Validation"

# Batch 4: CMS Operators
run_script "04-validate-cms-operators.js" "Batch 4: CMS Operator Validation"

# Batch 5: Property Owners
run_script "05-validate-property-owners.js" "Batch 5: Property Owner Validation"

# Batch 6: Principals
run_script "06-validate-principals.js" "Batch 6: Principal Validation"

# Batch 7: Addresses
run_script "07-validate-addresses.js" "Batch 7: Address Verification"

# Batch 7b: REAPI Addresses
run_script "07b-validate-reapi-addresses.js" "Batch 7b: REAPI Address Verification"

# Final Report
run_script "08-generate-audit-report.js" "Final Report Generation"

echo ""
echo "=============================================="
echo "AUDIT COMPLETE"
echo "=============================================="
echo "Finished: $(date)"
echo ""
echo "Output files in: $OUTPUT_DIR"
echo ""
echo "Key artifacts:"
echo "  - AUDIT_REPORT.md"
echo "  - DATA_QUALITY_SCORECARD.csv"
echo "  - PATCH_PLAN.md"
echo "  - CRM_GAP_REPORT.csv"
echo ""
echo "Review AUDIT_REPORT.md for findings summary."
