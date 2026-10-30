"""Download a pinned public synthetic PaySim archive, with integrity verification."""
import hashlib
import os
import tempfile
import urllib.request
from pathlib import Path

URL='https://huggingface.co/datasets/LordNR/AMLGraphX-Paysim/resolve/9dc2586/paysim.zip'
SHA256='75752bf75e5b064a7550399d802c77e10e873cb87831047b28371cf448979be4'
DEST=Path(__file__).resolve().parent/'data'/'paysim'/'paysim.zip'

def checksum(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

if __name__=='__main__':
    DEST.parent.mkdir(parents=True,exist_ok=True)
    if DEST.exists():
        if checksum(DEST)!=SHA256:raise SystemExit('Файл уже существует, но его контрольная сумма другая. Он не изменён.')
        print('PaySim уже находится в папке данных; контрольная сумма совпадает.')
    else:
        name=None
        try:
            with tempfile.NamedTemporaryFile(dir=DEST.parent,prefix='paysim-',suffix='.part',delete=False) as target:
                name=target.name
                with urllib.request.urlopen(URL,timeout=60) as source:
                    total=0
                    for chunk in iter(lambda:source.read(1024*1024),b''):
                        total+=len(chunk)
                        if total>250_000_000:raise ValueError('Архив превышает ожидаемый размер.')
                        target.write(chunk)
            if checksum(Path(name))!=SHA256:raise ValueError('Контрольная сумма архива не совпала.')
            os.replace(name,DEST);name=None
            print('Синтетический архив PaySim загружен и проверен. Лицензия: CC BY-SA 4.0; см. research/paysim-audit.md.')
        finally:
            if name and Path(name).exists():Path(name).unlink()
