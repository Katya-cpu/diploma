"""Quick, streaming audit of the public SynSEPA CSV; does not train a model."""
import csv
import json
import sys
from collections import Counter
from pathlib import Path

def audit(path):
    # first timestamp and count per receiver; labels reflect transactions, not verdicts on people
    receivers = {}
    senders = set()
    fraud_receivers = set()
    types = Counter()
    fraud_before_first_seen = 0
    rows = fraud = 0
    with open(path, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            rows += 1
            sender, recipient, time = row['sender_iban'], row['beneficiary_iban'], row['timestamp']
            senders.add(sender)
            record = receivers.get(recipient)
            if record is None:
                # count, earliest timestamp, earliest sender, multiple distinct senders
                receivers[recipient] = [1, time, sender, False]
            else:
                record[0] += 1
                record[1] = min(record[1], time)
                if sender != record[2]: record[3] = True
            if row['is_fraud'] == '1':
                fraud += 1
                fraud_receivers.add(recipient)
                types[row['fraud_type']] += 1
    result = {'rows':rows, 'fraud_transactions':fraud, 'fraud_types':dict(types), 'unique_senders':len(senders),
              'unique_receivers':len(receivers), 'receivers_with_multiple_transactions':sum(x[0]>1 for x in receivers.values()),
              'receivers_with_multiple_distinct_senders':sum(x[3] for x in receivers.values()),
              'fraud_receivers':len(fraud_receivers),
              'fraud_receivers_with_multiple_transactions':sum(receivers[x][0]>1 for x in fraud_receivers),
              'fraud_receivers_with_multiple_distinct_senders':sum(receivers[x][3] for x in fraud_receivers),
              'receiver_also_sender':sum(x in senders for x in receivers),
              'method_note':'Counts cover the entire dataset and use retrospective labels; they are not available as pre-transaction features. Repeat counts do not prove that history precedes a fraud.'}
    return result

if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1])), ensure_ascii=False, indent=2))
