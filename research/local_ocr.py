"""Local OCR experiment; requires Tesseract and Russian language data.

Use only fictional images. Printed text is automatically masked for long numeric
sequences, but masking is not a reliable privacy guarantee.
"""
import argparse
import re
from pathlib import Path
from PIL import Image
import pytesseract

def main():
    p=argparse.ArgumentParser();p.add_argument('image',type=Path);p.add_argument('--language',default='rus+eng');a=p.parse_args()
    text=pytesseract.image_to_string(Image.open(a.image),lang=a.language)
    text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[числовые реквизиты скрыты]',text)
    print(text)

if __name__=='__main__':main()
