import pandas as pd

# Read the CT rate data Excel file
file_path = r'C:\Users\MSuLL\dev\.projects\3GHCRE\data\medicaid_rates\CT_rate_comp_data_2012-2024.xlsx'

# Check sheet names first
xl = pd.ExcelFile(file_path)
print("Sheet names:", xl.sheet_names)

# Read first sheet
df = pd.read_excel(file_path, sheet_name=0)
print("\nColumns:", df.columns.tolist())
print("\nShape:", df.shape)
print("\nFirst 5 rows:")
print(df.head())
print("\nLast 5 rows:")
print(df.tail())
