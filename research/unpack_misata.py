"""Extract the one needed CSV from the bundled, public CC0 dataset archive."""
from pathlib import Path
import shutil
import zipfile

ROOT=Path(__file__).resolve().parent
archive=ROOT/'data'/'misata-aml.zip'
target=ROOT/'data'/'misata'/'transactions.csv'
target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive) as source:
    with source.open('transactions.csv') as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
print('Extracted:',target)
