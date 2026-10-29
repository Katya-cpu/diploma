"""Convert Misata synthetic AML operations to a bipartite directed graph.

Account and counterparty IDs are distinct namespaces; absent counterparties are
excluded. `aml_suspicious` refers to AML ground truth, not purchase scams.
"""
import argparse
import csv
from pathlib import Path

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    total=skipped=0
    with a.input.open(encoding='utf-8',newline='') as src,a.output.open('w',encoding='utf-8',newline='') as dst:
        reader=csv.DictReader(src);writer=csv.writer(dst);writer.writerow(['time','sender','recipient','amount','scenario_label'])
        for row in reader:
            total+=1;counterparty=row['counterparty_id'];direction=row['direction'].lower()
            if not counterparty or direction not in ('credit','debit'):skipped+=1;continue
            account='ACCOUNT_'+row['account_id'];other='COUNTERPARTY_'+counterparty
            sender,receiver=(other,account) if direction=='credit' else (account,other)
            label='aml_suspicious' if row['is_suspicious'].lower()=='true' else 'ordinary'
            writer.writerow([row['txn_at'],sender,receiver,row['amount'],label])
    print(f'Processed {total} transactions; skipped {skipped} without a usable counterparty or direction.')
