"""Optional explicit download of a small GGUF model from its original author.

Run on a machine with internet. No model output is sent to a remote service.
"""
from pathlib import Path
import shutil
from huggingface_hub import hf_hub_download

filename='qwen2.5-0.5b-instruct-q4_k_m.gguf'
source=hf_hub_download(repo_id='Qwen/Qwen2.5-0.5B-Instruct-GGUF',filename=filename,revision='9217f5d')
target=Path(__file__).resolve().parent/'models'/'context.gguf'
target.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(source,target)
print('Model saved to',target)
