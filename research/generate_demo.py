"""Generate a small fictional payment network for the laboratory.

All data is fictional. Labels describe the generator's scenarios, not real crime.
"""
import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

def generate(target: Path, seed: int = 42):
    rng = random.Random(seed)
    target.mkdir(parents=True, exist_ok=True)
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    transactions = []
    for day in range(45):
        for _ in range(180):
            destination = f'M{rng.randrange(80):03}' if rng.random()<0.7 else f'P{rng.randrange(1500):04}'
            transactions.append((start + timedelta(days=day, seconds=rng.randrange(86400)),
                                 f'U{rng.randrange(1000):04}', destination,
                                 round(rng.uniform(100, 10000), 2), 'ordinary'))
        # Legitimate crowdfunding-style fan-in is a counterexample to a naive rule.
        if day % 5 == 0:
            for sender in range(7):
                transactions.append((start + timedelta(days=day, seconds=rng.randrange(7200)),
                                     f'G{day:03}_{sender:02}', f'CHARITY{day//5:03}',
                                     round(rng.uniform(100, 2000), 2), 'ordinary'))
        if day % 3 == 0:
            recipient = f'R{day // 3:03}'
            for victim in range(rng.randint(3, 8)):
                # Spread a scenario over two days so that earlier neighbours exist.
                transactions.append((start + timedelta(days=day+(victim%2), seconds=rng.randrange(7200)),
                                     f'V{day:03}_{victim:02}', recipient,
                                     round(rng.uniform(1500, 15000), 2), 'simulated_scam'))
    transactions.sort(key=lambda x:x[0])
    with (target / 'transactions.csv').open('w', newline='', encoding='utf-8') as file:
        out=csv.writer(file);out.writerow(['time','sender','recipient','amount','scenario_label'])
        for time, sender, recipient, amount, label in transactions:
            out.writerow([time.isoformat(),sender,recipient,amount,label])
    print(f'Saved {len(transactions)} fictional transfers in {target}')

if __name__=='__main__':
    generate(Path(__file__).resolve().parent / 'demo_data')
