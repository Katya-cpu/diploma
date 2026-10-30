"""Transaction features and graph must exclude same-day and future transactions."""
import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
from train_paysim_transactions import build_snapshots

class TemporalTest(unittest.TestCase):
    def test_future_label_and_edges_do_not_change_earlier_snapshot(self):
        rows=[]
        for day in range(1,7):
            rows.append({'time':f'2025-01-{day:02d}T12:00:00Z','sender':'A','recipient':'B','amount':10,'scenario_label':'ordinary','source_type':'TRANSFER'})
        frame=pd.DataFrame(rows);first=build_snapshots(frame)[0]
        self.assertEqual(first['edges'].shape[1],2)
        changed=frame.copy();changed.loc[4,'scenario_label']='paysim_fraud';changed.loc[4,'amount']=999999
        after=build_snapshots(changed)[0]
        np.testing.assert_array_equal(first['x'],after['x']);np.testing.assert_array_equal(first['edges'],after['edges']);np.testing.assert_array_equal(first['extra'],after['extra'])
        self.assertEqual(first['y'].tolist(),[0])

if __name__=='__main__':unittest.main()
