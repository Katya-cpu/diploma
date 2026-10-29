"""Fine-tune a locally available token-classification checkpoint on BIO labels.

Use the same JSON input format as train_ner.py. Runs on a separate machine only.
No model weights or labelled dataset are bundled. Report must be reviewed for
leakage between sites/campaigns before citing any metric.
"""
import argparse
import json
from pathlib import Path
from datasets import Dataset
import numpy as np
from sklearn.metrics import precision_recall_fscore_support
from transformers import AutoTokenizer, AutoModelForTokenClassification, DataCollatorForTokenClassification, Trainer, TrainingArguments

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True,help='Path to an already downloaded local checkpoint');p.add_argument('--train',type=Path,required=True);p.add_argument('--test',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    train=json.loads(a.train.read_text(encoding='utf-8'));test=json.loads(a.test.read_text(encoding='utf-8'))
    tags=sorted({tag for row in train for tag in row['tags']});ids={tag:i for i,tag in enumerate(tags)}
    if any(tag not in ids for row in test for tag in row['tags']):raise ValueError('В оценке встретились классы, отсутствующие в обучении')
    tokenizer=AutoTokenizer.from_pretrained(a.model,local_files_only=True,use_fast=True)
    def convert(row):
        encoded=tokenizer(row['tokens'],is_split_into_words=True,truncation=True,max_length=384)
        labels=[];previous=None
        for word in encoded.word_ids():
            labels.append(-100 if word is None or word==previous else ids[row['tags'][word]])
            previous=word
        encoded['labels']=labels;return encoded
    train_ds=Dataset.from_list(train).map(convert,remove_columns=['tokens','tags'])
    test_ds=Dataset.from_list(test).map(convert,remove_columns=['tokens','tags'])
    model=AutoModelForTokenClassification.from_pretrained(a.model,local_files_only=True,num_labels=len(tags),id2label={i:s for i,s in enumerate(tags)},label2id=ids,ignore_mismatched_sizes=True)
    args=TrainingArguments(output_dir=str(a.out),num_train_epochs=3,per_device_train_batch_size=4,per_device_eval_batch_size=4,report_to='none',save_strategy='no',seed=42)
    def evaluate(pred):
        logits,truth=pred;guess=np.argmax(logits,axis=-1);mask=truth!=-100
        precision,recall,f1,_=precision_recall_fscore_support(truth[mask],guess[mask],average='macro',zero_division=0)
        return {'token_macro_precision':precision,'token_macro_recall':recall,'token_macro_f1':f1}
    trainer=Trainer(model=model,args=args,train_dataset=train_ds,eval_dataset=test_ds,data_collator=DataCollatorForTokenClassification(tokenizer),compute_metrics=evaluate)
    trainer.train();result=trainer.evaluate();trainer.save_model(str(a.out));tokenizer.save_pretrained(str(a.out))
    (a.out/'evaluation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
